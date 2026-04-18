import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import { chunkText, type TtsChunk } from "../chunker/tts.js";
import type { Config } from "../config.js";
import { concatAudioFiles } from "../post/concat.js";
import { estimateCost, tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import type { CostEstimate } from "../pricing/types.js";
import {
  createTtsProvider,
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
  type ResolvedSlot,
} from "../providers/registry.js";
import type { ProviderId, Tier, TtsGenResult } from "../providers/types.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import type { BudgetWarning, CallEntry, PeriodTotal } from "../state/types.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { withFailover, type FailoverDetails } from "../util/failover.js";
import { buildOutputPath, saveBinary, slugify, timestamp } from "../util/output.js";

export interface GenerateSpeechArgs {
  text: string;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  voice?: string;
  outputPath?: string;
}

export interface GenerateSpeechOutput {
  success: true;
  files: string[];
  providerUsed: ProviderId;
  modelUsed: string;
  tier: Tier;
  voiceUsed: string | undefined;
  mimeType: string;
  cost: CostEstimate;
  sessionTotal: {
    today: PeriodTotal;
    allTime: PeriodTotal;
    currency: string;
  };
  sidecar: string;
  cached: boolean;
  budgetWarning: BudgetWarning | null;
  failover: FailoverDetails | null;
  chunkCount: number;
  chunkFiles?: string[];
}

export interface GenerateSpeechOpts {
  parentSidecar?: string;
}

function inlineSlot(provider: ProviderId, tier: Tier, model: string): ResolvedSlot {
  return {
    provider,
    modality: "tts",
    tier,
    model,
    batchable: false,
    params: {},
    voices: [],
    defaultVoice: undefined,
    customVoicesAllowed: true,
    maxCharsPerCall: undefined,
  };
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function generateSpeech(
  args: GenerateSpeechArgs,
  config: Config,
  opts: GenerateSpeechOpts = {},
): Promise<GenerateSpeechOutput> {
  if (!args.text || args.text.trim().length === 0) {
    throw new StructuredError("VALIDATION_ERROR", "text is required", "Pass non-empty text.");
  }

  const requestedProvider = args.provider ?? getDefaultProvider("tts");
  const tier = args.tier ?? getDefaultTier();

  let providerUsed: ProviderId = requestedProvider;
  let slot: ResolvedSlot = args.model
    ? inlineSlot(requestedProvider, tier, args.model)
    : resolveSlot({ provider: requestedProvider, modality: "tts", tier });

  let voice = args.voice ?? slot.defaultVoice;
  if (
    voice &&
    slot.voices.length > 0 &&
    !slot.customVoicesAllowed &&
    !slot.voices.includes(voice)
  ) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `voice "${voice}" not supported by ${requestedProvider}/${tier} (${slot.model}). Available: ${slot.voices.join(", ")}.`,
      `Pick from the listed voices, or omit --voice to use ${slot.defaultVoice ?? "the default"}.`,
    );
  }

  const cacheKey = buildCacheKey({
    provider: requestedProvider,
    model: slot.model,
    modality: "tts",
    text: args.text,
    voice,
    params: slot.params,
  });
  const cached = await lookupCache(cacheKey);

  let budgetWarning: BudgetWarning | null = null;
  if (!cached) {
    const projectedCost =
      tryEstimateCost(
        { provider: requestedProvider, model: slot.model, modality: "tts", params: slot.params },
        args.text.length,
      ) ?? { total: 0 };
    const check = await checkBudget(projectedCost.total);
    if (check.block) {
      throw new StructuredError(
        "BUDGET_EXCEEDED",
        formatBudgetBlockError(check.block),
        `Raise the cap with set_budget --daily ${(check.block.cap * 2).toFixed(2)}, switch to a cheaper tier, or wait for the period to reset.`,
      );
    }
    budgetWarning = check.warning;
  }

  let mimeType: string;
  let modelUsed: string;
  let filePath: string;
  let failover: FailoverDetails | null = null;
  let chunkFiles: string[] | undefined;
  let chunkCount = 1;

  // Decide whether to chunk: only when not cached, not explicit-model, and slot.maxCharsPerCall is set + exceeded.
  const limit = slot.maxCharsPerCall;
  const needsChunking =
    !cached && !args.model && limit !== undefined && args.text.length > limit;

  if (cached) {
    mimeType = cached.meta.mimeType;
    modelUsed = slot.model;
    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: config.audioOutputDir,
      explicitPath: args.outputPath,
    });
    await copyFromCache(cached, filePath);
  } else if (needsChunking) {
    const chunks = chunkText(args.text, limit!);
    chunkCount = chunks.length;

    // Generate each chunk via failover-aware path.
    const chunkResults = await Promise.all(
      chunks.map((c) =>
        withFailover<TtsGenResult>({
          modality: "tts",
          tier,
          preferredProvider: requestedProvider,
          config,
          callProvider: async (resolvedSlot, attemptProviderId) => {
            const provider = createTtsProvider(attemptProviderId, config);
            return await provider.generateSpeech({
              text: c.text,
              model: resolvedSlot.model,
              voice: args.voice ?? resolvedSlot.defaultVoice,
              params: resolvedSlot.params,
            });
          },
        }),
      ),
    );

    // All chunks must use the same provider/model — pick from first.
    const first = chunkResults[0];
    providerUsed = first.providerUsed;
    slot = first.slot;
    voice = args.voice ?? slot.defaultVoice;
    mimeType = first.result.mimeType;
    modelUsed = first.result.modelUsed;

    // Save each chunk file.
    const baseStem = `${timestamp()}-${slugify(args.text)}`;
    const ext = mimeType.split("/")[1] === "mpeg" ? "mp3" : mimeType.split("/")[1] ?? "bin";
    const chunksDir = join(config.audioOutputDir, ".chunks");
    await mkdir(chunksDir, { recursive: true });
    chunkFiles = [];
    for (let i = 0; i < chunkResults.length; i++) {
      const chunkPath = join(chunksDir, `${baseStem}-chunk-${i + 1}.${ext}`);
      await writeFile(chunkPath, chunkResults[i].result.data);
      chunkFiles.push(chunkPath);
    }

    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: config.audioOutputDir,
      explicitPath: args.outputPath,
    });
    await concatAudioFiles(chunkFiles, filePath);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${providerUsed}/${modelUsed}`,
    });
  } else if (args.model) {
    const provider = createTtsProvider(requestedProvider, config);
    let result;
    try {
      result = await provider.generateSpeech({
        text: args.text,
        model: slot.model,
        voice,
        params: slot.params,
      });
    } catch (err) {
      throw mapProviderError(err, requestedProvider);
    }
    mimeType = result.mimeType;
    modelUsed = result.modelUsed;
    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: config.audioOutputDir,
      explicitPath: args.outputPath,
    });
    await saveBinary(filePath, result.data);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${requestedProvider}/${modelUsed}`,
    });
  } else {
    const fallbackResult = await withFailover({
      modality: "tts",
      tier,
      preferredProvider: requestedProvider,
      config,
      callProvider: async (resolvedSlot, attemptProviderId) => {
        const provider = createTtsProvider(attemptProviderId, config);
        const attemptVoice = args.voice ?? resolvedSlot.defaultVoice;
        return await provider.generateSpeech({
          text: args.text,
          model: resolvedSlot.model,
          voice: attemptVoice,
          params: resolvedSlot.params,
        });
      },
    });
    providerUsed = fallbackResult.providerUsed;
    slot = fallbackResult.slot;
    voice = args.voice ?? slot.defaultVoice;
    mimeType = fallbackResult.result.mimeType;
    modelUsed = fallbackResult.result.modelUsed;
    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: config.audioOutputDir,
      explicitPath: args.outputPath,
    });
    await saveBinary(filePath, fallbackResult.result.data);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${providerUsed}/${modelUsed}`,
    });

    if (fallbackResult.failover) {
      const originalCost = (() => {
        try {
          return estimateCost(
            {
              provider: fallbackResult.failover.originalProvider,
              model: fallbackResult.failover.originalModel,
              modality: "tts",
              params: {},
            },
            args.text.length,
          ).total;
        } catch {
          return 0;
        }
      })();
      const newCost = estimateCost(
        { provider: providerUsed, model: modelUsed, modality: "tts", params: slot.params },
        args.text.length,
      );
      failover = {
        originalProvider: fallbackResult.failover.originalProvider,
        originalModel: fallbackResult.failover.originalModel,
        originalError: fallbackResult.failover.originalError,
        fallbackProvider: providerUsed,
        fallbackModel: modelUsed,
        costDelta: roundUsd(newCost.total - originalCost),
        currency: newCost.currency,
      };
    }
  }

  const charCount = args.text.length;
  const costQuery = {
    provider: providerUsed,
    model: modelUsed,
    modality: "tts" as const,
    params: slot.params,
  };
  const cost =
    tryEstimateCost(costQuery, charCount) ?? unknownCostEstimate(costQuery, charCount);

  const isCached = cached !== null;
  const chargedCost = isCached ? 0 : cost.total;

  const entry: CallEntry = {
    ts: new Date().toISOString(),
    tool: "generate_speech",
    provider: providerUsed,
    model: modelUsed,
    tier,
    modality: "tts",
    units: charCount,
    unit: cost.unit,
    pricePerUnit: cost.pricePerUnit,
    isBatchPrice: cost.isBatchPrice,
    cost: chargedCost,
    files: [filePath],
    cached: isCached,
  };
  const session = await appendCall(entry);
  const summary = summarize(session);

  const lineage = await readLineageFromParent(opts.parentSidecar);
  const sidecarPath = await writeSidecar(filePath, {
    version: 1,
    createdAt: entry.ts,
    tool: "generate_speech",
    modality: "tts",
    provider: providerUsed,
    model: modelUsed,
    tier,
    params: slot.params,
    input: { text: args.text, voice },
    output: { files: [filePath], mimeType },
    cost: { ...cost, total: chargedCost },
    lineage,
    cached: isCached,
  });

  return {
    success: true,
    files: [filePath],
    providerUsed,
    modelUsed,
    tier,
    voiceUsed: voice,
    mimeType,
    cost: { ...cost, total: chargedCost },
    sessionTotal: {
      today: summary.totals.today,
      allTime: summary.totals.allTime,
      currency: session.currency,
    },
    sidecar: sidecarPath,
    cached: isCached,
    budgetWarning,
    failover,
    chunkCount,
    chunkFiles,
  };
}
