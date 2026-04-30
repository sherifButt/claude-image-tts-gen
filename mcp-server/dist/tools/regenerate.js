import { dirname } from "node:path";
import { isSidecarPath, readSidecar, sidecarPathFor } from "../sidecar/metadata.js";
import { generateImage } from "./generate-image.js";
import { generateSpeech } from "./generate-speech.js";
export async function regenerate(args, config) {
    if (!args.path) {
        throw new Error("path is required (sidecar .regenerate.json or original output file)");
    }
    const sidecarPath = sidecarPathFor(args.path);
    const meta = await readSidecar(sidecarPath);
    const originalDir = resolveOriginalDir(args.path, meta);
    if (meta.tool === "generate_image") {
        const input = meta.input;
        return await generateImage({
            prompt: input.prompt,
            provider: meta.provider,
            tier: meta.tier,
            model: meta.model,
            aspectRatio: input.aspectRatio,
            referenceImagePath: input.referenceImagePath,
            outputPath: args.outputPath,
            outputDir: args.outputPath ? undefined : originalDir,
        }, config, { parentSidecar: sidecarPath });
    }
    if (meta.tool === "generate_speech") {
        const input = meta.input;
        return await generateSpeech({
            text: input.text,
            voice: input.voice,
            referenceAudioPath: input.referenceAudioPath,
            provider: meta.provider,
            tier: meta.tier,
            model: meta.model,
            outputPath: args.outputPath,
            outputDir: args.outputPath ? undefined : originalDir,
        }, config, { parentSidecar: sidecarPath });
    }
    throw new Error(`Unknown tool in sidecar: ${meta.tool}`);
}
/**
 * Figure out the directory the original output lived in, so the re-roll
 * lands next to it unless the caller passed an explicit outputPath. Falls
 * back to the sidecar's recorded file if the caller passed only a sidecar
 * path (no file).
 */
function resolveOriginalDir(inputPath, meta) {
    if (!isSidecarPath(inputPath)) {
        return dirname(inputPath);
    }
    const first = meta.output.files[0];
    return first ? dirname(first) : undefined;
}
