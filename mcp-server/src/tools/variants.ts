import { dirname, join } from "node:path";
import type { Config } from "../config.js";
import { composeContactSheet } from "../post/contact-sheet.js";
import type { ProviderId, Tier } from "../providers/types.js";
import { StructuredError } from "../util/errors.js";
import { slugify, timestamp } from "../util/output.js";
import { generateImage, type GenerateImageOutput } from "./generate-image.js";

export interface VariantsArgs {
  prompt: string;
  n?: number;
  provider?: ProviderId;
  tier?: Tier;
  model?: string;
}

export interface VariantsOutput {
  success: true;
  prompt: string;
  variants: GenerateImageOutput[];
  contactSheet: string;
  totalCost: number;
  currency: string;
  text: string;
}

const MAX_N = 9;

export async function variants(
  args: VariantsArgs,
  config: Config,
): Promise<VariantsOutput> {
  if (!args.prompt || args.prompt.trim().length === 0) {
    throw new StructuredError("VALIDATION_ERROR", "prompt is required", "Pass a non-empty prompt.");
  }
  const n = args.n ?? 4;
  if (n < 2 || n > MAX_N) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      `n must be between 2 and ${MAX_N} (got ${n})`,
      `Try n=4 (default) or up to ${MAX_N} for a 3x3 sheet.`,
    );
  }

  // Run n generations in parallel.
  const results = await Promise.all(
    Array.from({ length: n }, () =>
      generateImage(
        {
          prompt: args.prompt,
          provider: args.provider,
          tier: args.tier,
          model: args.model,
        },
        config,
      ),
    ),
  );

  const variantPaths = results.map((r) => r.files[0]);
  const baseDir = dirname(variantPaths[0]);
  const sheetPath = join(baseDir, `contact-sheet-${timestamp()}-${slugify(args.prompt)}.png`);
  await composeContactSheet(variantPaths, sheetPath);

  const totalCost = results.reduce((sum, r) => sum + r.cost.total, 0);
  const currency = results[0]?.cost.currency ?? "USD";

  return {
    success: true,
    prompt: args.prompt,
    variants: results,
    contactSheet: sheetPath,
    totalCost,
    currency,
    text:
      `Generated ${n} variants.\n` +
      `Contact sheet: ${sheetPath}\n` +
      `Total cost: ${currency} ${totalCost.toFixed(4)}\n` +
      `Variants:\n` +
      variantPaths.map((p, i) => `  ${i + 1}. ${p}`).join("\n") +
      `\n\nPick a keeper with pick_variant --keeper <path> --variants ${variantPaths.length}-paths`,
  };
}
