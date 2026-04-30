import { dirname } from "node:path";
import { isSidecarPath, readSidecar, sidecarPathFor } from "../sidecar/metadata.js";
import { StructuredError } from "../util/errors.js";
import { generateImage, } from "./generate-image.js";
import { generateSpeech, } from "./generate-speech.js";
export async function iterate(args, config) {
    if (!args.path) {
        throw new StructuredError("VALIDATION_ERROR", "path is required (sidecar .regenerate.json or original output file)", "Pass --path the file or sidecar from the prior generation.");
    }
    if (!args.adjustment || args.adjustment.trim().length === 0) {
        throw new StructuredError("VALIDATION_ERROR", "adjustment is required", "Pass an instruction like \"make it more dramatic\" or \"darker mood\".");
    }
    const sidecarPath = sidecarPathFor(args.path);
    const meta = await readSidecar(sidecarPath);
    const mode = args.mode ?? "append";
    const originalDir = resolveOriginalDir(args.path, meta);
    if (meta.tool === "generate_image") {
        const input = meta.input;
        const newPrompt = mode === "replace" ? args.adjustment : `${input.prompt}, ${args.adjustment}`;
        return await generateImage({
            prompt: newPrompt,
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
        const newText = mode === "replace" ? args.adjustment : `${input.text} ${args.adjustment}`;
        return await generateSpeech({
            text: newText,
            voice: input.voice,
            referenceAudioPath: input.referenceAudioPath,
            provider: meta.provider,
            tier: meta.tier,
            model: meta.model,
            outputPath: args.outputPath,
            outputDir: args.outputPath ? undefined : originalDir,
        }, config, { parentSidecar: sidecarPath });
    }
    throw new StructuredError("VALIDATION_ERROR", `Unknown tool in sidecar: ${meta.tool}`, "Sidecar may be malformed. Re-generate from a known-good source.");
}
function resolveOriginalDir(inputPath, meta) {
    if (!isSidecarPath(inputPath)) {
        return dirname(inputPath);
    }
    const first = meta.output.files[0];
    return first ? dirname(first) : undefined;
}
