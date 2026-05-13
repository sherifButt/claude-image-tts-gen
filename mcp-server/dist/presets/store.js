import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getStateDir } from "../state/store.js";
function getPath(kind) {
    return join(getStateDir(), "presets", kind === "style" ? "styles.json" : "voices.json");
}
async function ensureFile(filePath) {
    if (existsSync(filePath))
        return;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}\n", "utf8");
}
async function withLock(filePath, fn) {
    await ensureFile(filePath);
    const release = await lockfile.lock(filePath, {
        retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
        stale: 5000,
    });
    try {
        return await fn();
    }
    finally {
        await release();
    }
}
export async function readStylePresets() {
    const filePath = getPath("style");
    await ensureFile(filePath);
    return JSON.parse(await readFile(filePath, "utf8"));
}
export async function readVoicePresets() {
    const filePath = getPath("voice");
    await ensureFile(filePath);
    return JSON.parse(await readFile(filePath, "utf8"));
}
export async function saveStylePreset(name, preset) {
    const filePath = getPath("style");
    return withLock(filePath, async () => {
        const all = JSON.parse(await readFile(filePath, "utf8")) ?? {};
        all[name] = preset;
        await writeFile(filePath, JSON.stringify(all, null, 2) + "\n", "utf8");
        return all;
    });
}
export async function saveVoicePreset(name, preset) {
    const filePath = getPath("voice");
    return withLock(filePath, async () => {
        const all = JSON.parse(await readFile(filePath, "utf8")) ?? {};
        all[name] = preset;
        await writeFile(filePath, JSON.stringify(all, null, 2) + "\n", "utf8");
        return all;
    });
}
export async function deletePreset(kind, name) {
    const filePath = getPath(kind);
    await withLock(filePath, async () => {
        const all = JSON.parse(await readFile(filePath, "utf8"));
        if (!(name in all))
            return;
        delete all[name];
        await writeFile(filePath, JSON.stringify(all, null, 2) + "\n", "utf8");
    });
}
