import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { SidecarLineage, SidecarMetadata } from "./types.js";

const SIDECAR_SUFFIX = ".regenerate.json";

/**
 * Current (dotfile) sidecar path: /dir/.foo.png.regenerate.json.
 * Hidden from `ls`, Finder, and most git UIs by default.
 */
export function sidecarPathFor(outputPath: string): string {
  if (isSidecarPath(outputPath)) return outputPath;
  const dir = dirname(outputPath);
  const base = basename(outputPath);
  // Don't double-dot if caller already passed ".foo.png"
  const dotted = base.startsWith(".") ? base : `.${base}`;
  return join(dir, `${dotted}${SIDECAR_SUFFIX}`);
}

/** Legacy (pre-0.3.0) sidecar path — kept for read-fallback only. */
export function legacySidecarPathFor(outputPath: string): string {
  if (isSidecarPath(outputPath)) return outputPath;
  return `${outputPath}${SIDECAR_SUFFIX}`;
}

export function isSidecarPath(p: string): boolean {
  return p.endsWith(SIDECAR_SUFFIX);
}

export async function writeSidecar(
  outputPath: string,
  metadata: SidecarMetadata,
): Promise<string> {
  const path = sidecarPathFor(outputPath);
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(metadata, null, 2) + "\n", "utf8");
  return abs;
}

export async function readSidecar(path: string): Promise<SidecarMetadata> {
  // Caller may pass the sidecar path directly (either dotfile or legacy).
  if (isSidecarPath(path)) return await readAndParse(path);

  // Try the current (dotfile) name first, fall back to the legacy name so
  // files generated before 0.3.0 still work.
  const dotfile = sidecarPathFor(path);
  try {
    return await readAndParse(dotfile);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    const legacy = legacySidecarPathFor(path);
    return await readAndParse(legacy);
  }
}

async function readAndParse(path: string): Promise<SidecarMetadata> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as SidecarMetadata;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported sidecar version: ${parsed.version}`);
  }
  return parsed;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export async function readLineageFromParent(
  parentPath: string | undefined,
): Promise<SidecarLineage> {
  if (!parentPath) return { parent: null, iteration: 0 };
  const parent = await readSidecar(parentPath);
  return {
    parent: sidecarPathFor(parentPath),
    iteration: parent.lineage.iteration + 1,
  };
}
