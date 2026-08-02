import { spawn } from "node:child_process";
import { ffmpegAvailable } from "./concat.js";
/** Lazily loaded sharp — optional dep, may be absent. */
async function loadSharp() {
    try {
        return (await import("sharp")).default;
    }
    catch {
        return null;
    }
}
function toDataUri(webp) {
    return `data:image/webp;base64,${webp.toString("base64")}`;
}
/**
 * Small inline webp thumbnail for a still image. Returns a data: URI, or null
 * when sharp is unavailable or the file can't be read (caller degrades to a
 * placeholder / full-res reference).
 */
export async function imageThumbDataUri(path, maxPx = 512) {
    const sharp = await loadSharp();
    if (!sharp)
        return null;
    try {
        const webp = await sharp(path)
            .rotate() // honour EXIF orientation
            .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer();
        return toDataUri(webp);
    }
    catch {
        return null;
    }
}
/** Pixel dimensions of a still image via sharp. null if sharp is missing or the
 *  file can't be read. */
export async function imageDimensions(path) {
    const sharp = await loadSharp();
    if (!sharp)
        return null;
    try {
        const m = await sharp(path).metadata();
        if (m.width && m.height)
            return { width: m.width, height: m.height, format: m.format };
        return null;
    }
    catch {
        return null;
    }
}
/** Pixel dimensions of a video's first stream via ffprobe. null if ffprobe is
 *  absent or fails. */
export function videoDimensions(path) {
    return new Promise((resolve) => {
        const proc = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", path], { stdio: ["ignore", "pipe", "ignore"] });
        let out = "";
        proc.stdout?.on("data", (d) => (out += String(d)));
        proc.on("error", () => resolve(null));
        proc.on("exit", (code) => {
            const m = /^(\d+)x(\d+)/.exec(out.trim());
            resolve(code === 0 && m ? { width: Number(m[1]), height: Number(m[2]) } : null);
        });
    });
}
/** Grab a single frame from a video as a PNG buffer via ffmpeg (stdout pipe). */
function extractVideoFramePng(path, atSeconds) {
    return new Promise((resolve) => {
        const proc = spawn("ffmpeg", ["-ss", String(atSeconds), "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { stdio: ["ignore", "pipe", "ignore"] });
        const chunks = [];
        proc.stdout?.on("data", (d) => chunks.push(d));
        proc.on("error", () => resolve(null));
        proc.on("exit", (code) => {
            if (code === 0 && chunks.length > 0)
                resolve(Buffer.concat(chunks));
            else
                resolve(null);
        });
    });
}
/**
 * Poster-frame thumbnail for a video (webp data: URI). Needs ffmpeg (to grab a
 * frame) and sharp (to downscale). Returns null if either is missing or the
 * extraction fails — caller shows a film-strip placeholder instead.
 */
export async function videoPosterDataUri(path, maxPx = 512) {
    if (!(await ffmpegAvailable()))
        return null;
    const sharp = await loadSharp();
    if (!sharp)
        return null;
    // Grab ~1s in (avoids black leading frames); fall back to frame 0.
    const png = (await extractVideoFramePng(path, 1)) ?? (await extractVideoFramePng(path, 0));
    if (!png)
        return null;
    try {
        const webp = await sharp(png)
            .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer();
        return toDataUri(webp);
    }
    catch {
        return null;
    }
}
