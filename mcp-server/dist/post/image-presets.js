import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { StructuredError } from "../util/errors.js";
export const PRESETS = {
    og: { width: 1200, height: 630, description: "Open Graph card" },
    twitter: { width: 1200, height: 675, description: "Twitter / X large card" },
    favicon: { width: 32, height: 32, description: "favicon.ico size" },
    "app-icon": { width: 1024, height: 1024, description: "iOS / Android app icon" },
    linkedin: { width: 1200, height: 627, description: "LinkedIn share image" },
    "instagram-square": { width: 1080, height: 1080, description: "Instagram square post" },
    "instagram-story": { width: 1080, height: 1920, description: "Instagram story / Reels" },
};
async function loadSharp() {
    try {
        const mod = await import("sharp");
        // sharp ships as a CJS-default-export — both .default and the namespace are callable depending on bundler.
        return (mod.default ?? mod);
    }
    catch {
        throw new StructuredError("CONFIG_ERROR", "sharp is required for image post-processing but is not installed", "Run `npm install sharp` in mcp-server/. On Linux, libvips may be required.");
    }
}
export async function resizeToPreset(inputPath, preset, outputPath) {
    const spec = PRESETS[preset];
    if (!spec) {
        throw new StructuredError("VALIDATION_ERROR", `Unknown preset: ${preset}`, `Available: ${Object.keys(PRESETS).join(", ")}`);
    }
    const sharp = await loadSharp();
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(inputPath)
        .resize(spec.width, spec.height, { fit: "cover", position: "centre" })
        .toFile(outputPath);
}
export async function convertToWebp(inputPath, outputPath, quality = 85) {
    const sharp = await loadSharp();
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(inputPath).webp({ quality }).toFile(outputPath);
}
export function suggestOutputPath(inputPath, preset, format = "png") {
    const dot = inputPath.lastIndexOf(".");
    const base = dot === -1 ? inputPath : inputPath.slice(0, dot);
    return `${base}.${preset}.${format}`;
}
