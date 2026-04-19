import { dirname } from "node:path";
import type { Config } from "../config.js";
import { isSidecarPath, readSidecar, sidecarPathFor } from "../sidecar/metadata.js";
import type {
  SidecarImageInput,
  SidecarMetadata,
  SidecarSpeechInput,
} from "../sidecar/types.js";
import { StructuredError } from "../util/errors.js";
import {
  generateImage,
  type GenerateImageOutput,
} from "./generate-image.js";
import {
  generateSpeech,
  type GenerateSpeechOutput,
} from "./generate-speech.js";

export interface IterateArgs {
  path: string;
  adjustment: string;
  mode?: "append" | "replace";
  outputPath?: string;
}

export type IterateOutput = GenerateImageOutput | GenerateSpeechOutput;

export async function iterate(
  args: IterateArgs,
  config: Config,
): Promise<IterateOutput> {
  if (!args.path) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "path is required (sidecar .regenerate.json or original output file)",
      "Pass --path the file or sidecar from the prior generation.",
    );
  }
  if (!args.adjustment || args.adjustment.trim().length === 0) {
    throw new StructuredError(
      "VALIDATION_ERROR",
      "adjustment is required",
      "Pass an instruction like \"make it more dramatic\" or \"darker mood\".",
    );
  }

  const sidecarPath = sidecarPathFor(args.path);
  const meta = await readSidecar(sidecarPath);
  const mode = args.mode ?? "append";
  const originalDir = resolveOriginalDir(args.path, meta);

  if (meta.tool === "generate_image") {
    const input = meta.input as SidecarImageInput;
    const newPrompt = mode === "replace" ? args.adjustment : `${input.prompt}, ${args.adjustment}`;
    return await generateImage(
      {
        prompt: newPrompt,
        provider: meta.provider,
        tier: meta.tier,
        model: meta.model,
        aspectRatio: input.aspectRatio,
        referenceImagePath: input.referenceImagePath,
        outputPath: args.outputPath,
        outputDir: args.outputPath ? undefined : originalDir,
      },
      config,
      { parentSidecar: sidecarPath },
    );
  }

  if (meta.tool === "generate_speech") {
    const input = meta.input as SidecarSpeechInput;
    const newText = mode === "replace" ? args.adjustment : `${input.text} ${args.adjustment}`;
    return await generateSpeech(
      {
        text: newText,
        voice: input.voice,
        referenceAudioPath: input.referenceAudioPath,
        provider: meta.provider,
        tier: meta.tier,
        model: meta.model,
        outputPath: args.outputPath,
        outputDir: args.outputPath ? undefined : originalDir,
      },
      config,
      { parentSidecar: sidecarPath },
    );
  }

  throw new StructuredError(
    "VALIDATION_ERROR",
    `Unknown tool in sidecar: ${(meta as { tool: string }).tool}`,
    "Sidecar may be malformed. Re-generate from a known-good source.",
  );
}

function resolveOriginalDir(
  inputPath: string,
  meta: SidecarMetadata,
): string | undefined {
  if (!isSidecarPath(inputPath)) {
    return dirname(inputPath);
  }
  const first = meta.output.files[0];
  return first ? dirname(first) : undefined;
}
