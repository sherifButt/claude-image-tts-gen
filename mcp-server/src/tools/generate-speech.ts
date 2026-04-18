import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import type { Config } from "../config.js";
import { estimateCost } from "../pricing/load.js";
import type { CostEstimate } from "../pricing/types.js";
import {
  createTtsProvider,
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
} from "../providers/registry.js";
import type { ProviderId, Tier } from "../providers/types.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import {
  checkBudget,
  formatBudgetBlockError,
} from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import type {
  BudgetWarning,
  CallEntry,
  PeriodTotal,
} from "../state/types.js";
import { buildOutputPath, saveBinary } from "../util/output.js";

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
}

export interface GenerateSpeechOpts {
  parentSidecar?: string;
}

export async function generateSpeech(
  args: GenerateSpeechArgs,
  config: Config,
  opts: GenerateSpeechOpts = {},
): Promise<GenerateSpeechOutput> {
  if (!args.text || args.text.trim().length === 0) {
    throw new Error("text is required");
  }

  const providerId = args.provider ?? getDefaultProvider("tts");
  const tier = args.tier ?? getDefaultTier();

  const slot = args.model
    ? {
        provider: providerId,
        tier,
        model: args.model,
        batchable: false,
        params: {} as Record<string, unknown>,
        voices: [] as readonly string[],
        defaultVoice: undefined,
        customVoicesAllowed: true,
      }
    : resolveSlot({ provider: providerId, modality: "tts", tier });

  const voice = args.voice ?? slot.defaultVoice;
  if (
    voice &&
    slot.voices.length > 0 &&
    !slot.customVoicesAllowed &&
    !slot.voices.includes(voice)
  ) {
    throw new Error(
      `voice "${voice}" not supported by ${providerId}/${tier} (${slot.model}). ` +
        `Available: ${slot.voices.join(", ")}.`,
    );
  }

  const cacheKey = buildCacheKey({
    provider: providerId,
    model: slot.model,
    modality: "tts",
    text: args.text,
    voice,
    params: slot.params,
  });
  const cached = await lookupCache(cacheKey);

  let budgetWarning: BudgetWarning | null = null;
  if (!cached) {
    const projectedCost = estimateCost(
      { provider: providerId, model: slot.model, modality: "tts", params: slot.params },
      args.text.length,
    );
    const check = await checkBudget(projectedCost.total);
    if (check.block) {
      const err = new Error(formatBudgetBlockError(check.block));
      (err as Error & { code?: string }).code = "BUDGET_EXCEEDED";
      throw err;
    }
    budgetWarning = check.warning;
  }

  let mimeType: string;
  let modelUsed: string;
  let filePath: string;

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
  } else {
    const provider = createTtsProvider(providerId, config);
    const result = await provider.generateSpeech({
      text: args.text,
      model: slot.model,
      voice,
      params: slot.params,
    });
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
      modelKey: `${providerId}/${modelUsed}`,
    });
  }

  const charCount = args.text.length;
  const cost = estimateCost(
    {
      provider: providerId,
      model: modelUsed,
      modality: "tts",
      params: slot.params,
    },
    charCount,
  );

  const isCached = cached !== null;
  const chargedCost = isCached ? 0 : cost.total;

  const entry: CallEntry = {
    ts: new Date().toISOString(),
    tool: "generate_speech",
    provider: providerId,
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
    provider: providerId,
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
    providerUsed: providerId,
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
  };
}
