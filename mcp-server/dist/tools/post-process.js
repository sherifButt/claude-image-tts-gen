import { existsSync } from "node:fs";
import { PRESETS, convertToWebp, resizeToPreset, suggestOutputPath, } from "../post/image-presets.js";
import { removeBackground, suggestBgRemoveOutputPath } from "../post/bg-remove.js";
import { StructuredError } from "../util/errors.js";
export async function postProcess(args) {
    if (!args.input) {
        throw new StructuredError("VALIDATION_ERROR", "input is required", "Pass --input <image path>.");
    }
    if (!existsSync(args.input)) {
        throw new StructuredError("NOT_FOUND", `Input file not found: ${args.input}`, "Pass an existing image file path.");
    }
    const presets = args.presets ?? [];
    for (const p of presets) {
        if (!(p in PRESETS)) {
            throw new StructuredError("VALIDATION_ERROR", `Unknown preset: ${p}`, `Available: ${Object.keys(PRESETS).join(", ")}`);
        }
    }
    if (presets.length === 0 && !args.webp && !args.bgRemove) {
        throw new StructuredError("VALIDATION_ERROR", "Specify at least one preset, set webp:true, or set bgRemove:true", "Example: presets=['og','twitter'], webp=true, or bgRemove=true.");
    }
    const outputs = [];
    // bg-remove runs first so presets inherit the cutout. The cutout becomes
    // the new "source" for downstream resizing/webp.
    let source = args.input;
    let cutoutPath = null;
    if (args.bgRemove) {
        cutoutPath = suggestBgRemoveOutputPath(args.input);
        await removeBackground(args.input, cutoutPath);
        outputs.push({ format: "png", path: cutoutPath, bgRemoved: true });
        source = cutoutPath;
    }
    for (const preset of presets) {
        const pngOut = suggestOutputPath(source, preset, "png");
        await resizeToPreset(source, preset, pngOut);
        outputs.push({ preset, format: "png", path: pngOut, bgRemoved: cutoutPath !== null });
        if (args.webp) {
            const webpOut = suggestOutputPath(source, preset, "webp");
            await convertToWebp(pngOut, webpOut, args.webpQuality);
            outputs.push({ preset, format: "webp", path: webpOut, bgRemoved: cutoutPath !== null });
        }
    }
    if (presets.length === 0 && args.webp) {
        const webpOut = source.replace(/\.[^.]+$/, ".webp");
        await convertToWebp(source, webpOut, args.webpQuality);
        outputs.push({ format: "webp", path: webpOut, bgRemoved: cutoutPath !== null });
    }
    return {
        success: true,
        input: args.input,
        outputs,
        text: `Post-processed ${args.input} into ${outputs.length} file${outputs.length === 1 ? "" : "s"}:\n` +
            outputs
                .map((o) => `  ${o.bgRemoved ? "[bg-removed] " : ""}${o.preset ?? (o.format === "webp" ? "(webp)" : "(cutout)")}: ${o.path}`)
                .join("\n"),
    };
}
