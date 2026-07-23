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
import {
  isAspectRatio,
  isImageResolution,
  pixelsToResolutionTier,
  validateOpenAICustomSize,
  type AspectRatio,
  type ImageResolution,
} from "../util/aspect.js";
import { mapProviderError, StructuredError } from "../util/errors.js";
import { withFailover, type FailoverDetails } from "../util/failover.js";
import { buildOutputPath, saveBinary } from "../util/output.js";

export interface GenerateImageArgs {
  prompt: string;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  outputPath?: string;
  /** Directory for the auto-generated filename. Overrides config.imageOutputDir. */
  outputDir?: string;
  /** Apply a saved style preset (provider/tier/model defaults + prompt prefix/suffix). */
  style?: string;
  /** Path to a reference image to use as input (image-to-image). Sugar for
   *  the 1-element case of `referenceImagePaths`. */
  referenceImagePath?: string;
  /** Multiple reference images for image-to-image / multi-reference
   *  composition (e.g. gpt-image-2, gemini-3.1-flash-image-preview). When both
   *  this and `referenceImagePath` are passed, they're concatenated in order. */
  referenceImagePaths?: string[];
  /** Output aspect ratio. Defaults to 1:1 when omitted. */
  aspectRatio?: AspectRatio;
  /** Output resolution tier: 1K (default) / 2K / 4K. gpt-image-2 only —
   *  ignored by other providers. Combined with aspectRatio → concrete size. */
  resolution?: ImageResolution;
  /** Exact gpt-image-2 output size "WIDTHxHEIGHT" (overrides resolution +
   *  aspectRatio). openai only; validated against gpt-image-2's constraints. */
  size?: string;
  /** Background: auto (default) / opaque / transparent. gpt-image family only
   *  (openai); transparent is unsupported on gpt-image-2. */
  background?: "auto" | "opaque" | "transparent";
  /** Write a .regenerate.json sidecar next to the output. Default true (or EMIT_SIDECAR env). */
  sidecar?: boolean;
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
  /** Sidecar file path, or empty string when sidecar writing is disabled. */
  sidecar: string;
  cached: boolean;
  budgetWarning: BudgetWarning | null;
  failover: FailoverDetails | null;
}

export interface GenerateImageOpts {
  parentSidecar?: string;
}

function inlineSlot(provider: ProviderId, tier: Tier, model: string): ResolvedSlot {
  try {
    const registered = resolveSlot({ provider, modality: "image", tier });
    if (registered.model === model) return registered;
  } catch {
    // (provider, image, tier) isn't registered — fall through.
  }
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

  if (args.resolution !== undefined && !isImageResolution(args.resolution)) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `Unknown resolution: ${String(args.resolution)}`,
      "Use 1K, 2K, or 4K. Higher resolutions are gpt-image-2 (openai) only.",
    );
  }
  const resolution = args.resolution;

  // Custom size (gpt-image-2) overrides resolution+aspect. Validate up front.
  let customSizePixels: number | undefined;
  if (args.size !== undefined) {
    const v = validateOpenAICustomSize(args.size);
    if (!v.ok) {
      throw new StructuredError(
        "VALIDATION_ERROR",
        `Invalid size "${args.size}": ${v.reason}`,
        "gpt-image-2 sizes: WIDTHxHEIGHT, both ÷16, max edge 3840, ratio ≤3:1, 0.65–8.3 MP (e.g. 2048x1152, 3840x2160).",
      );
    }
    customSizePixels = v.width * v.height;
  }
  const size = args.size;

  if (
    args.background !== undefined &&
    !["auto", "opaque", "transparent"].includes(args.background)
  ) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `Unknown background: ${String(args.background)}`,
      "Use auto, opaque, or transparent (transparent is gpt-image-1 only — gpt-image-2 rejects it).",
    );
  }
  const background = args.background;

  // Resolution tier used for pricing: a custom size maps to the nearest tier
  // by megapixels; otherwise the explicit resolution knob.
  const pricingResolution: ImageResolution | undefined =
    customSizePixels !== undefined ? pixelsToResolutionTier(customSizePixels) : resolution;

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

  // Load reference images if requested. Singular `referenceImagePath` is
  // sugar for a 1-element array; when both are passed, concatenate in order
  // (singular first, then the array).
  const refPaths = [
    ...(args.referenceImagePath ? [args.referenceImagePath] : []),
    ...(args.referenceImagePaths ?? []),
  ];
  const referenceImages: ReferenceImage[] = [];
  for (const path of refPaths) {
    if (!existsSync(path)) {
      throw new StructuredError(
        "NOT_FOUND",
        `Reference image not found: ${path}`,
        "Pass an existing image file path.",
      );
    }
    const data = await readFile(path);
    const ext = path.toLowerCase().split(".").pop() ?? "png";
    const mimeType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
      ext === "webp" ? "image/webp" :
      ext === "png" ? "image/png" :
      "image/png";
    referenceImages.push({ data, mimeType, path });
  }

  let providerUsed: ProviderId = requestedProvider;
  let slot: ResolvedSlot = explicitModel
    ? inlineSlot(requestedProvider, tier, explicitModel)
    : resolveSlot({ provider: requestedProvider, modality: "image", tier });

  // Cache key: preserve the legacy `ref` shape for the single-reference
  // case so pre-multi-ref cached entries still hit. Multi-ref uses `refs`.
  const refKeyParams: Record<string, unknown> = {};
  if (referenceImages.length === 1) {
    refKeyParams.ref = referenceImages[0].path ?? "buffer";
  } else if (referenceImages.length > 1) {
    refKeyParams.refs = referenceImages.map((r) => r.path ?? "buffer");
  }
  // Resolution / custom size / background are gpt-image-2 (openai) concerns.
  // For PRICING we fold the resolution tier into the key (custom sizes charge
  // the nearest tier). For CACHE we also key on the exact size + background so
  // different outputs don't collide. Other providers ignore all of it.
  const priceResParams = (p: ProviderId): Record<string, unknown> =>
    p === "openai" && pricingResolution && pricingResolution !== "1K"
      ? { resolution: pricingResolution }
      : {};
  const cacheExtras = (p: ProviderId): Record<string, unknown> => {
    if (p !== "openai") return {};
    const out: Record<string, unknown> = {};
    if (size) out.size = size;
    else if (pricingResolution && pricingResolution !== "1K") out.resolution = pricingResolution;
    if (background && background !== "auto") out.background = background;
    return out;
  };

  const cacheKey = buildCacheKey({
    provider: requestedProvider,
    model: slot.model,
    modality: "image",
    text: resolvedPrompt,
    params: {
      ...slot.params,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...cacheExtras(requestedProvider),
      ...refKeyParams,
    },
  });
  const cached = await lookupCache(cacheKey);

  let budgetWarning: BudgetWarning | null = null;
  if (!cached) {
    const projectedCost =
      tryEstimateCost(
        {
          provider: requestedProvider,
          model: slot.model,
          modality: "image",
          params: { ...slot.params, ...priceResParams(requestedProvider) },
        },
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
      outputDir: args.outputDir ?? config.imageOutputDir,
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
        referenceImages,
        aspectRatio,
        resolution,
        size,
        background,
      });
    } catch (err) {
      throw mapProviderError(err, requestedProvider);
    }
    mimeType = result.mimeType;
    modelUsed = result.modelUsed;
    filePath = buildOutputPath({
      prompt: resolvedPrompt,
      mimeType,
      outputDir: args.outputDir ?? config.imageOutputDir,
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
          referenceImages,
          aspectRatio,
          resolution,
          size,
          background,
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
      outputDir: args.outputDir ?? config.imageOutputDir,
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
    params: { ...slot.params, ...priceResParams(providerUsed) },
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

  const shouldEmitSidecar = args.sidecar ?? config.emitSidecar;
  let sidecarPath = "";
  if (shouldEmitSidecar) {
    const lineage = await readLineageFromParent(opts.parentSidecar);
    sidecarPath = await writeSidecar(filePath, {
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
        ...(refPaths.length > 0 ? { referenceImagePaths: refPaths } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(size ? { size } : {}),
        ...(background ? { background } : {}),
      },
      output: { files: [filePath], mimeType },
      cost: { ...cost, total: chargedCost },
      lineage,
      cached: isCached,
    });
  }

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
