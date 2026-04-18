import { existsSync } from "node:fs";
import {
  PRESETS,
  convertToWebp,
  resizeToPreset,
  suggestOutputPath,
  type PresetName,
} from "../post/image-presets.js";
import { StructuredError } from "../util/errors.js";

export interface PostProcessArgs {
  input: string;
  presets?: PresetName[];
  /** Also convert each output (and the original if no presets) to webp. */
  webp?: boolean;
  webpQuality?: number;
}

export interface PostProcessResult {
  preset?: PresetName;
  format: "png" | "webp";
  path: string;
}

export interface PostProcessOutput {
  success: true;
  input: string;
  outputs: PostProcessResult[];
  text: string;
}

export async function postProcess(args: PostProcessArgs): Promise<PostProcessOutput> {
  if (!args.input) {
    throw new StructuredError("VALIDATION_ERROR", "input is required", "Pass --input <image path>.");
  }
  if (!existsSync(args.input)) {
    throw new StructuredError(
      "NOT_FOUND",
      `Input file not found: ${args.input}`,
      "Pass an existing image file path.",
    );
  }

  const presets = args.presets ?? [];
  for (const p of presets) {
    if (!(p in PRESETS)) {
      throw new StructuredError(
        "VALIDATION_ERROR",
        `Unknown preset: ${p}`,
        `Available: ${Object.keys(PRESETS).join(", ")}`,
      );
    }
  }

  if (presets.length === 0 && !args.webp) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "Specify at least one preset or set webp:true",
      "Example: presets=['og','twitter'] or webp=true.",
    );
  }

  const outputs: PostProcessResult[] = [];

  for (const preset of presets) {
    const pngOut = suggestOutputPath(args.input, preset, "png");
    await resizeToPreset(args.input, preset, pngOut);
    outputs.push({ preset, format: "png", path: pngOut });

    if (args.webp) {
      const webpOut = suggestOutputPath(args.input, preset, "webp");
      await convertToWebp(pngOut, webpOut, args.webpQuality);
      outputs.push({ preset, format: "webp", path: webpOut });
    }
  }

  if (presets.length === 0 && args.webp) {
    const webpOut = args.input.replace(/\.[^.]+$/, ".webp");
    await convertToWebp(args.input, webpOut, args.webpQuality);
    outputs.push({ format: "webp", path: webpOut });
  }

  return {
    success: true,
    input: args.input,
    outputs,
    text:
      `Post-processed ${args.input} into ${outputs.length} file${outputs.length === 1 ? "" : "s"}:\n` +
      outputs.map((o) => `  ${o.preset ?? "(webp)"}: ${o.path}`).join("\n"),
  };
}
