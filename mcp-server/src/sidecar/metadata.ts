import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { SidecarLineage, SidecarMetadata } from "./types.js";

const SIDECAR_SUFFIX = ".regenerate.json";

export function sidecarPathFor(outputPath: string): string {
  if (outputPath.endsWith(SIDECAR_SUFFIX)) return outputPath;
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
  const sidecarPath = isSidecarPath(path) ? path : sidecarPathFor(path);
  const raw = await readFile(sidecarPath, "utf8");
  const parsed = JSON.parse(raw) as SidecarMetadata;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported sidecar version: ${parsed.version}`);
  }
  return parsed;
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
