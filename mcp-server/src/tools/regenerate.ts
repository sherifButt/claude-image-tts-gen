import { dirname } from "node:path";
import type { Config } from "../config.js";
import { isSidecarPath, readSidecar, sidecarPathFor } from "../sidecar/metadata.js";
import type {
  SidecarImageInput,
  SidecarMetadata,
  SidecarSpeechInput,
} from "../sidecar/types.js";
import { generateImage, type GenerateImageOutput } from "./generate-image.js";
import { generateSpeech, type GenerateSpeechOutput } from "./generate-speech.js";

export interface RegenerateArgs {
  path: string;
  outputPath?: string;
}

export type RegenerateOutput = GenerateImageOutput | GenerateSpeechOutput;

export async function regenerate(
  args: RegenerateArgs,
  config: Config,
): Promise<RegenerateOutput> {
  if (!args.path) {
    throw new Error("path is required (sidecar .regenerate.json or original output file)");
  }

  const sidecarPath = sidecarPathFor(args.path);
  const meta = await readSidecar(sidecarPath);
  const originalDir = resolveOriginalDir(args.path, meta);

  if (meta.tool === "generate_image") {
    const input = meta.input as SidecarImageInput;
    return await generateImage(
      {
        prompt: input.prompt,
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
    return await generateSpeech(
      {
        text: input.text,
        voice: input.voice,
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

  throw new Error(`Unknown tool in sidecar: ${(meta as { tool: string }).tool}`);
}

/**
 * Figure out the directory the original output lived in, so the re-roll
 * lands next to it unless the caller passed an explicit outputPath. Falls
 * back to the sidecar's recorded file if the caller passed only a sidecar
 * path (no file).
 */
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
