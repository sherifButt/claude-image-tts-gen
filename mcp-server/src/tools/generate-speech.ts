import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import { chunkText, type TtsChunk } from "../chunker/tts.js";
import type { Config } from "../config.js";
import { writeCaptionFiles, type CaptionFiles, type CaptionFormat } from "../post/captions.js";
import { concatAudioFiles } from "../post/concat.js";
import { autoPlay } from "../post/play.js";
import { estimateCost, tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import type { CostEstimate } from "../pricing/types.js";
import {
  createTtsProvider,
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
  type ResolvedSlot,
} from "../providers/registry.js";
import type { ProviderId, Tier, TtsGenResult, WordAlignment } from "../providers/types.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import type { BudgetWarning, CallEntry, PeriodTotal } from "../state/types.js";
import { readVoicePresets } from "../presets/store.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { withFailover, type FailoverDetails } from "../util/failover.js";
import { buildOutputPath, saveBinary, slugify, timestamp } from "../util/output.js";

export type CaptionsMode = "none" | "srt" | "vtt" | "both";

export interface GenerateSpeechArgs {
  text: string;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  voice?: string;
  outputPath?: string;
  /** Directory for the auto-generated filename. Overrides config.audioOutputDir. */
  outputDir?: string;
  /** "none" (default), "srt", "vtt", or "both". Requires a provider that returns word alignment. */
  captions?: CaptionsMode;
  /** Apply a saved voice preset (provider/tier/model/voice defaults). */
  voicePreset?: string;
  /** Write a .regenerate.json sidecar next to the output. Default true (or EMIT_SIDECAR env). */
  sidecar?: boolean;
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
  captions?: CaptionFiles;
  captionsSkipped?: string;
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

  let presetProvider: ProviderId | undefined;
  let presetTier: Tier | undefined;
  let presetModel: string | undefined;
  let presetVoice: string | undefined;
  if (args.voicePreset) {
    const presets = await readVoicePresets();
    const preset = presets[args.voicePreset];
    if (!preset) {
      throw new StructuredError(
        "NOT_FOUND",
        `Voice preset "${args.voicePreset}" not found`,
        "Run list_presets to see what's saved, or save_voice_preset to create it.",
      );
    }
    presetProvider = preset.provider;
    presetTier = preset.tier;
    presetModel = preset.model;
    presetVoice = preset.voice;
  }

  const requestedProvider = args.provider ?? presetProvider ?? getDefaultProvider("tts");
  const tier = args.tier ?? presetTier ?? getDefaultTier();
  const explicitModel = args.model ?? presetModel;

  let providerUsed: ProviderId = requestedProvider;
  let slot: ResolvedSlot = explicitModel
    ? inlineSlot(requestedProvider, tier, explicitModel)
    : resolveSlot({ provider: requestedProvider, modality: "tts", tier });

  let voice = args.voice ?? presetVoice ?? slot.defaultVoice;
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
  let alignment: WordAlignment[] | undefined;
  const captionsMode: CaptionsMode = args.captions ?? "none";

  // Decide whether to chunk: only when not cached, not explicit-model, and slot.maxCharsPerCall is set + exceeded.
  const limit = slot.maxCharsPerCall;
  const needsChunking =
    !cached && !explicitModel && limit !== undefined && args.text.length > limit;

  if (cached) {
    mimeType = cached.meta.mimeType;
    modelUsed = slot.model;
    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: args.outputDir ?? config.audioOutputDir,
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
    const chunksDir = join(args.outputDir ?? config.audioOutputDir, ".chunks");
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
      outputDir: args.outputDir ?? config.audioOutputDir,
      explicitPath: args.outputPath,
    });
    await concatAudioFiles(chunkFiles, filePath);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${providerUsed}/${modelUsed}`,
    });
  } else if (explicitModel) {
    const provider = createTtsProvider(requestedProvider, config);
    let result;
    try {
      result = await provider.generateSpeech({
        text: args.text,
        model: slot.model,
        voice,
        params: slot.params,
        wantTimestamps: captionsMode !== "none",
      });
    } catch (err) {
      throw mapProviderError(err, requestedProvider);
    }
    mimeType = result.mimeType;
    modelUsed = result.modelUsed;
    alignment = result.alignment;
    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: args.outputDir ?? config.audioOutputDir,
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
          wantTimestamps: captionsMode !== "none",
        });
      },
    });
    providerUsed = fallbackResult.providerUsed;
    slot = fallbackResult.slot;
    voice = args.voice ?? slot.defaultVoice;
    mimeType = fallbackResult.result.mimeType;
    modelUsed = fallbackResult.result.modelUsed;
    alignment = fallbackResult.result.alignment;
    filePath = buildOutputPath({
      prompt: args.text,
      mimeType,
      outputDir: args.outputDir ?? config.audioOutputDir,
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

  const shouldEmitSidecar = args.sidecar ?? config.emitSidecar;
  let sidecarPath = "";
  if (shouldEmitSidecar) {
    const lineage = await readLineageFromParent(opts.parentSidecar);
    sidecarPath = await writeSidecar(filePath, {
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
  }

  if (config.autoplay) {
    autoPlay(filePath);
  }

  let captions: CaptionFiles | undefined;
  let captionsSkipped: string | undefined;
  if (captionsMode !== "none") {
    if (chunkCount > 1) {
      captionsSkipped =
        "Captions skipped: chunked TTS (multi-chunk timestamp offsets are not yet supported in v1).";
    } else if (!alignment || alignment.length === 0) {
      captionsSkipped = `Captions skipped: ${providerUsed} did not return word alignment for this call.`;
    } else {
      const formats: CaptionFormat[] =
        captionsMode === "both" ? ["srt", "vtt"] : [captionsMode];
      captions = await writeCaptionFiles(filePath, alignment, formats);
    }
  }

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
    captions,
    captionsSkipped,
  };
}
