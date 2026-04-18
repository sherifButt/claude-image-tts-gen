import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import type { Config } from "../config.js";
import { estimateCost } from "../pricing/load.js";
import type { CostEstimate } from "../pricing/types.js";
import {
  createImageProvider,
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
} from "../providers/registry.js";
import type { ProviderId, Tier } from "../providers/types.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import type { CallEntry, PeriodTotal } from "../state/types.js";
import { buildOutputPath, saveBinary } from "../util/output.js";

export interface GenerateImageArgs {
  prompt: string;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  outputPath?: string;
}

export interface GenerateImageOutput {
  success: true;
  files: string[];
  providerUsed: ProviderId;
  modelUsed: string;
  tier: Tier;
  mimeType: string;
  cost: CostEstimate;
  sessionTotal: {
    today: PeriodTotal;
    allTime: PeriodTotal;
    currency: string;
  };
  sidecar: string;
  cached: boolean;
}

export interface GenerateImageOpts {
  parentSidecar?: string;
}

export async function generateImage(
  args: GenerateImageArgs,
  config: Config,
  opts: GenerateImageOpts = {},
): Promise<GenerateImageOutput> {
  if (!args.prompt || args.prompt.trim().length === 0) {
    throw new Error("prompt is required");
  }

  const providerId = args.provider ?? getDefaultProvider("image");
  const tier = args.tier ?? getDefaultTier();

  const slot = args.model
    ? {
        provider: providerId,
        tier,
        model: args.model,
        batchable: false,
        params: {} as Record<string, unknown>,
      }
    : resolveSlot({ provider: providerId, modality: "image", tier });

  const cacheKey = buildCacheKey({
    provider: providerId,
    model: slot.model,
    modality: "image",
    text: args.prompt,
    params: slot.params,
  });
  const cached = await lookupCache(cacheKey);

  let mimeType: string;
  let modelUsed: string;
  let filePath: string;

  if (cached) {
    mimeType = cached.meta.mimeType;
    modelUsed = slot.model;
    filePath = buildOutputPath({
      prompt: args.prompt,
      mimeType,
      outputDir: config.imageOutputDir,
      explicitPath: args.outputPath,
    });
    await copyFromCache(cached, filePath);
  } else {
    const provider = createImageProvider(providerId, config);
    const result = await provider.generateImage({
      prompt: args.prompt,
      model: slot.model,
      params: slot.params,
    });
    mimeType = result.mimeType;
    modelUsed = result.modelUsed;
    filePath = buildOutputPath({
      prompt: args.prompt,
      mimeType,
      outputDir: config.imageOutputDir,
      explicitPath: args.outputPath,
    });
    await saveBinary(filePath, result.data);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${providerId}/${modelUsed}`,
    });
  }

  const cost = estimateCost(
    {
      provider: providerId,
      model: modelUsed,
      modality: "image",
      params: slot.params,
    },
    1,
  );

  const isCached = cached !== null;
  const chargedCost = isCached ? 0 : cost.total;

  const entry: CallEntry = {
    ts: new Date().toISOString(),
    tool: "generate_image",
    provider: providerId,
    model: modelUsed,
    tier,
    modality: "image",
    units: 1,
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
    tool: "generate_image",
    modality: "image",
    provider: providerId,
    model: modelUsed,
    tier,
    params: slot.params,
    input: { prompt: args.prompt },
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
    mimeType,
    cost: { ...cost, total: chargedCost },
    sessionTotal: {
      today: summary.totals.today,
      allTime: summary.totals.allTime,
      currency: session.currency,
    },
    sidecar: sidecarPath,
    cached: isCached,
  };
}
