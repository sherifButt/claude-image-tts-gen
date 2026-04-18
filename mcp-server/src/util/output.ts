import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join, dirname, isAbsolute } from "node:path";

export function slugify(input: string, maxLen = 40): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return cleaned.length > 0 ? cleaned : "asset";
}

export function timestamp(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

export function extensionForMime(mimeType: string): string {
  const subtype = (mimeType.split("/")[1] ?? "bin").toLowerCase();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "mpeg") return "mp3";
  if (subtype === "ogg") return "opus";
  if (subtype === "l16") return "pcm";
  return subtype.replace(/[^a-z0-9]/gi, "");
}

export function buildOutputPath(opts: {
  prompt: string;
  mimeType: string;
  outputDir: string;
  explicitPath?: string;
}): string {
  if (opts.explicitPath) {
    return isAbsolute(opts.explicitPath)
      ? opts.explicitPath
      : resolve(process.cwd(), opts.explicitPath);
  }
  const ext = extensionForMime(opts.mimeType);
  const filename = `${timestamp()}-${slugify(opts.prompt)}.${ext}`;
  const baseDir = isAbsolute(opts.outputDir)
    ? opts.outputDir
    : resolve(process.cwd(), opts.outputDir);
  return join(baseDir, filename);
}

export async function saveBinary(filePath: string, data: Buffer): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}
