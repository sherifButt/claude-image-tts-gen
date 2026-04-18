import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getStateDir } from "../state/store.js";
import type { StylePreset, StylePresets, VoicePreset, VoicePresets } from "./types.js";

export type PresetKind = "style" | "voice";

function getPath(kind: PresetKind): string {
  return join(getStateDir(), "presets", kind === "style" ? "styles.json" : "voices.json");
}

async function ensureFile(filePath: string): Promise<void> {
  if (existsSync(filePath)) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "{}\n", "utf8");
}

async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await ensureFile(filePath);
  const release = await lockfile.lock(filePath, {
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
    stale: 5000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function readStylePresets(): Promise<StylePresets> {
  const filePath = getPath("style");
  await ensureFile(filePath);
  return JSON.parse(await readFile(filePath, "utf8")) as StylePresets;
}

export async function readVoicePresets(): Promise<VoicePresets> {
  const filePath = getPath("voice");
  await ensureFile(filePath);
  return JSON.parse(await readFile(filePath, "utf8")) as VoicePresets;
}

export async function saveStylePreset(name: string, preset: StylePreset): Promise<StylePresets> {
  const filePath = getPath("style");
  return withLock(filePath, async () => {
    const all = (JSON.parse(await readFile(filePath, "utf8")) as StylePresets) ?? {};
    all[name] = preset;
    await writeFile(filePath, JSON.stringify(all, null, 2) + "\n", "utf8");
    return all;
  });
}

export async function saveVoicePreset(name: string, preset: VoicePreset): Promise<VoicePresets> {
  const filePath = getPath("voice");
  return withLock(filePath, async () => {
    const all = (JSON.parse(await readFile(filePath, "utf8")) as VoicePresets) ?? {};
    all[name] = preset;
    await writeFile(filePath, JSON.stringify(all, null, 2) + "\n", "utf8");
    return all;
  });
}

export async function deletePreset(kind: PresetKind, name: string): Promise<void> {
  const filePath = getPath(kind);
  await withLock(filePath, async () => {
    const all = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    if (!(name in all)) return;
    delete all[name];
    await writeFile(filePath, JSON.stringify(all, null, 2) + "\n", "utf8");
  });
}
