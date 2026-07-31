import { spawn } from "node:child_process";
import { ffmpegAvailable } from "./concat.js";

/** Lazily loaded sharp — optional dep, may be absent. */
async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

function toDataUri(webp: Buffer): string {
  return `data:image/webp;base64,${webp.toString("base64")}`;
}

/**
 * Small inline webp thumbnail for a still image. Returns a data: URI, or null
 * when sharp is unavailable or the file can't be read (caller degrades to a
 * placeholder / full-res reference).
 */
export async function imageThumbDataUri(path: string, maxPx = 512): Promise<string | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const webp = await sharp(path)
      .rotate() // honour EXIF orientation
      .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return toDataUri(webp);
  } catch {
    return null;
  }
}

/** Grab a single frame from a video as a PNG buffer via ffmpeg (stdout pipe). */
function extractVideoFramePng(path: string, atSeconds: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffmpeg",
      ["-ss", String(atSeconds), "-i", path, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    proc.stdout?.on("data", (d: Buffer) => chunks.push(d));
    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else resolve(null);
    });
  });
}

/**
 * Poster-frame thumbnail for a video (webp data: URI). Needs ffmpeg (to grab a
 * frame) and sharp (to downscale). Returns null if either is missing or the
 * extraction fails — caller shows a film-strip placeholder instead.
 */
export async function videoPosterDataUri(path: string, maxPx = 512): Promise<string | null> {
  if (!(await ffmpegAvailable())) return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  // Grab ~1s in (avoids black leading frames); fall back to frame 0.
  const png = (await extractVideoFramePng(path, 1)) ?? (await extractVideoFramePng(path, 0));
  if (!png) return null;
  try {
    const webp = await sharp(png)
      .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return toDataUri(webp);
  } catch {
    return null;
  }
}
