import { buildCacheKey } from "../cache/key.js";
import { copyFromCache, lookupCache, storeInCache } from "../cache/store.js";
import type { Config } from "../config.js";
import { estimateCost, tryEstimateCost, unknownCostEstimate } from "../pricing/load.js";
import type { CostEstimate } from "../pricing/types.js";
import {
  createImageProvider,
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
  type ResolvedSlot,
} from "../providers/registry.js";
import type { ProviderId, Tier } from "../providers/types.js";
import { readLineageFromParent, writeSidecar } from "../sidecar/metadata.js";
import { checkBudget, formatBudgetBlockError } from "../state/budget.js";
import { appendCall } from "../state/store.js";
import { summarize } from "../state/spend.js";
import type { BudgetWarning, CallEntry, PeriodTotal } from "../state/types.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readStylePresets } from "../presets/store.js";
import type { ReferenceImage } from "../providers/types.js";
import { extensionForMime } from "../util/output.js";
import { isAspectRatio, type AspectRatio } from "../util/aspect.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { withFailover, type FailoverDetails } from "../util/failover.js";
import { buildOutputPath, saveBinary } from "../util/output.js";

export interface GenerateImageArgs {
  prompt: string;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  outputPath?: string;
  /** Apply a saved style preset (provider/tier/model defaults + prompt prefix/suffix). */
  style?: string;
  /** Path to a reference image to use as input (image-to-image). */
  referenceImagePath?: string;
  /** Output aspect ratio. Defaults to 1:1 when omitted. */
  aspectRatio?: AspectRatio;
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
  budgetWarning: BudgetWarning | null;
  failover: FailoverDetails | null;
}

export interface GenerateImageOpts {
  parentSidecar?: string;
}

function inlineSlot(provider: ProviderId, tier: Tier, model: string): ResolvedSlot {
  return {
    provider,
    modality: "image",
    tier,
    model,
    batchable: false,
    params: {},
    voices: [],
    defaultVoice: undefined,
    customVoicesAllowed: false,
    maxCharsPerCall: undefined,
  };
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function generateImage(
  args: GenerateImageArgs,
  config: Config,
  opts: GenerateImageOpts = {},
): Promise<GenerateImageOutput> {
  if (!args.prompt || args.prompt.trim().length === 0) {
    throw new StructuredError("VALIDATION_ERROR", "prompt is required", "Pass a non-empty prompt.");
  }

  if (args.aspectRatio !== undefined && !isAspectRatio(args.aspectRatio)) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `Unknown aspectRatio: ${String(args.aspectRatio)}`,
      `Use one of 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9.`,
    );
  }
  const aspectRatio = args.aspectRatio;

  // Apply style preset if requested. Explicit args still win.
  let resolvedPrompt = args.prompt;
  let presetProvider: ProviderId | undefined;
  let presetTier: Tier | undefined;
  let presetModel: string | undefined;
  if (args.style) {
    const presets = await readStylePresets();
    const preset = presets[args.style];
    if (!preset) {
      throw new StructuredError(
        "NOT_FOUND",
        `Style preset "${args.style}" not found`,
        "Run list_presets to see what's saved, or save_style_preset to create it.",
      );
    }
    resolvedPrompt = `${preset.promptPrefix ?? ""}${preset.promptPrefix ? " " : ""}${args.prompt}${preset.promptSuffix ? ", " + preset.promptSuffix : ""}`.trim();
    presetProvider = preset.provider;
    presetTier = preset.tier;
    presetModel = preset.model;
  }

  const requestedProvider = args.provider ?? presetProvider ?? getDefaultProvider("image");
  const tier = args.tier ?? presetTier ?? getDefaultTier();
  const explicitModel = args.model ?? presetModel;

  // Load reference image if requested.
  let referenceImage: ReferenceImage | undefined;
  if (args.referenceImagePath) {
    if (!existsSync(args.referenceImagePath)) {
      throw new StructuredError(
        "NOT_FOUND",
        `Reference image not found: ${args.referenceImagePath}`,
        "Pass an existing image file path.",
      );
    }
    const data = await readFile(args.referenceImagePath);
    const ext = args.referenceImagePath.toLowerCase().split(".").pop() ?? "png";
    const mimeType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
      ext === "webp" ? "image/webp" :
      ext === "png" ? "image/png" :
      "image/png";
    referenceImage = { data, mimeType, path: args.referenceImagePath };
  }

  let providerUsed: ProviderId = requestedProvider;
  let slot: ResolvedSlot = explicitModel
    ? inlineSlot(requestedProvider, tier, explicitModel)
    : resolveSlot({ provider: requestedProvider, modality: "image", tier });

  const cacheKey = buildCacheKey({
    provider: requestedProvider,
    model: slot.model,
    modality: "image",
    text: resolvedPrompt,
    params: {
      ...slot.params,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(referenceImage ? { ref: referenceImage.path ?? "buffer" } : {}),
    },
  });
  const cached = await lookupCache(cacheKey);

  let budgetWarning: BudgetWarning | null = null;
  if (!cached) {
    const projectedCost =
      tryEstimateCost(
        { provider: requestedProvider, model: slot.model, modality: "image", params: slot.params },
        1,
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

  if (cached) {
    mimeType = cached.meta.mimeType;
    modelUsed = slot.model;
    filePath = buildOutputPath({
      prompt: resolvedPrompt,
      mimeType,
      outputDir: config.imageOutputDir,
      explicitPath: args.outputPath,
    });
    await copyFromCache(cached, filePath);
  } else if (explicitModel) {
    // Explicit model override — skip failover, user wants this exact model.
    const provider = createImageProvider(requestedProvider, config);
    let result;
    try {
      result = await provider.generateImage({
        prompt: resolvedPrompt,
        model: slot.model,
        params: slot.params,
        referenceImage,
        aspectRatio,
      });
    } catch (err) {
      throw mapProviderError(err, requestedProvider);
    }
    mimeType = result.mimeType;
    modelUsed = result.modelUsed;
    filePath = buildOutputPath({
      prompt: resolvedPrompt,
      mimeType,
      outputDir: config.imageOutputDir,
      explicitPath: args.outputPath,
    });
    await saveBinary(filePath, result.data);
    await storeInCache(cacheKey, filePath, {
      mimeType,
      modelKey: `${requestedProvider}/${modelUsed}`,
    });
  } else {
    const fallbackResult = await withFailover({
      modality: "image",
      tier,
      preferredProvider: requestedProvider,
      config,
      callProvider: async (resolvedSlot, attemptProviderId) => {
        const provider = createImageProvider(attemptProviderId, config);
        return await provider.generateImage({
          prompt: resolvedPrompt,
          model: resolvedSlot.model,
          params: resolvedSlot.params,
          referenceImage,
          aspectRatio,
        });
      },
    });
    providerUsed = fallbackResult.providerUsed;
    slot = fallbackResult.slot;
    mimeType = fallbackResult.result.mimeType;
    modelUsed = fallbackResult.result.modelUsed;
    filePath = buildOutputPath({
      prompt: resolvedPrompt,
      mimeType,
      outputDir: config.imageOutputDir,
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
              modality: "image",
              params: {},
            },
            1,
          ).total;
        } catch {
          return 0;
        }
      })();
      const newCost = estimateCost(
        { provider: providerUsed, model: modelUsed, modality: "image", params: slot.params },
        1,
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

  const costQuery = {
    provider: providerUsed,
    model: modelUsed,
    modality: "image" as const,
    params: slot.params,
  };
  const cost =
    tryEstimateCost(costQuery, 1) ?? unknownCostEstimate(costQuery, 1);

  const isCached = cached !== null;
  const chargedCost = isCached ? 0 : cost.total;

  const entry: CallEntry = {
    ts: new Date().toISOString(),
    tool: "generate_image",
    provider: providerUsed,
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
    provider: providerUsed,
    model: modelUsed,
    tier,
    params: slot.params,
    input: {
      prompt: resolvedPrompt,
      ...(args.referenceImagePath ? { referenceImagePath: args.referenceImagePath } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
    },
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
  };
}
