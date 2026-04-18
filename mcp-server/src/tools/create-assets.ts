import type { Config } from "../config.js";
import { estimateCost } from "../pricing/load.js";
import {
  getDefaultProvider,
  getDefaultTier,
  resolveSlot,
} from "../providers/registry.js";
import type { Modality, ProviderId, Tier } from "../providers/types.js";
import { StructuredError } from "../util/errors.js";
import { batchSubmit, type BatchSubmitOutput } from "./batch-submit.js";
import {
  generateImage,
  type GenerateImageOutput,
} from "./generate-image.js";
import {
  generateSpeech,
  type GenerateSpeechOutput,
} from "./generate-speech.js";

export type CreateAssetsMode = "batch" | "sync" | "auto";

export interface CreateAssetsArgs {
  modality: Modality;
  prompts: Array<{ text: string; voice?: string }>;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
  mode?: CreateAssetsMode;
}

export interface BatchModeAvailability {
  available: boolean;
  reason: string;
  syncCost?: number;
  batchCost?: number;
  savings?: number;
  currency?: string;
}

export interface CreateAssetsOutput {
  success: true;
  mode: "batch" | "sync";
  // Sync mode populates results
  results?: Array<GenerateImageOutput | GenerateSpeechOutput>;
  // Batch mode populates batch
  batch?: BatchSubmitOutput;
  text: string;
}

/** Computes whether batch is an option for these prompts and the cost delta. */
export function checkBatchAvailability(args: CreateAssetsArgs): BatchModeAvailability {
  if (args.prompts.length < 2) {
    return { available: false, reason: "single prompt — no batch benefit" };
  }
  const providerId = args.provider ?? getDefaultProvider(args.modality);
  const tier = args.tier ?? getDefaultTier();
  let slot;
  try {
    slot = resolveSlot({ provider: providerId, modality: args.modality, tier });
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!slot.batchable) {
    return {
      available: false,
      reason: `${providerId}/${tier} (${slot.model}) does not support batch`,
    };
  }

  const units =
    args.modality === "image"
      ? args.prompts.length
      : args.prompts.reduce((sum, p) => sum + p.text.length, 0);

  const sync = estimateCost(
    { provider: providerId, model: slot.model, modality: args.modality, params: slot.params },
    units,
  );
  const batch = estimateCost(
    { provider: providerId, model: slot.model, modality: args.modality, params: slot.params },
    units,
    { useBatch: true },
  );

  return {
    available: true,
    reason: "batch supported",
    syncCost: sync.total,
    batchCost: batch.total,
    savings: sync.total - batch.total,
    currency: sync.currency,
  };
}

export async function createAssets(
  args: CreateAssetsArgs,
  config: Config,
): Promise<CreateAssetsOutput> {
  if (!args.prompts || args.prompts.length === 0) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "prompts array is required and must contain at least one entry",
      "Pass an array like [{text: '...'}, ...].",
    );
  }

  const availability = checkBatchAvailability(args);
  // Resolve mode. 'auto' falls back to sync at the tool level — server.ts
  // can pre-resolve via elicitation before calling here.
  let mode: "batch" | "sync";
  const requested = args.mode ?? "auto";
  if (requested === "batch") {
    if (!availability.available) {
      throw new StructuredError(
        "VALIDATION_ERROR",
        `mode=batch requested but batch is not available: ${availability.reason}`,
        `Use mode=sync, or pick a batch-capable provider.`,
      );
    }
    mode = "batch";
  } else if (requested === "sync") {
    mode = "sync";
  } else {
    // auto → sync (server.ts can elicit upgrade to batch beforehand)
    mode = "sync";
  }

  if (mode === "batch") {
    const batch = await batchSubmit(
      {
        modality: args.modality,
        prompts: args.prompts,
        provider: args.provider,
        tier: args.tier,
        model: args.model,
      },
      config,
    );
    return {
      success: true,
      mode: "batch",
      batch,
      text: batch.text,
    };
  }

  // sync mode — run in parallel
  const results = await Promise.all(
    args.prompts.map((p) =>
      args.modality === "image"
        ? generateImage(
            {
              prompt: p.text,
              provider: args.provider,
              tier: args.tier,
              model: args.model,
            },
            config,
          )
        : generateSpeech(
            {
              text: p.text,
              voice: p.voice,
              provider: args.provider,
              tier: args.tier,
              model: args.model,
            },
            config,
          ),
    ),
  );

  const totalCost = results.reduce((sum, r) => sum + r.cost.total, 0);
  const currency = results[0]?.cost.currency ?? "USD";
  const lines = [
    `Sync mode: ${results.length} ${args.modality} files generated.`,
    `Total cost: ${currency} ${totalCost.toFixed(4)}`,
  ];
  if (availability.available && availability.savings && availability.savings > 0) {
    lines.push(
      `Tip: batch mode would have cost ${availability.currency} ${availability.batchCost?.toFixed(4)} ` +
        `(${availability.currency} ${availability.savings.toFixed(4)} cheaper, but ≤24h turnaround).`,
    );
  }
  for (const r of results) {
    lines.push(`  ${r.files[0]}`);
  }
  return {
    success: true,
    mode: "sync",
    results,
    text: lines.join("\n"),
  };
}
