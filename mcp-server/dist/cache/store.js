import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getStateDir } from "../state/store.js";
export function getCacheDir() {
    return join(getStateDir(), "cache");
}
export function getCacheEntryDir(hash) {
    return join(getCacheDir(), hash);
}
export async function lookupCache(hash) {
    const dir = getCacheEntryDir(hash);
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath))
        return null;
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    const filePath = join(dir, meta.filename);
    if (!existsSync(filePath))
        return null;
    return { filePath, meta };
}
export async function storeInCache(hash, sourceFilePath, meta) {
    const dir = getCacheEntryDir(hash);
    await mkdir(dir, { recursive: true });
    const filename = basename(sourceFilePath);
    await copyFile(sourceFilePath, join(dir, filename));
    const full = {
        cachedAt: new Date().toISOString(),
        filename,
        mimeType: meta.mimeType,
        modelKey: meta.modelKey,
    };
    await writeFile(join(dir, "meta.json"), JSON.stringify(full, null, 2) + "\n", "utf8");
}
export async function copyFromCache(hit, destPath) {
    const { dirname } = await import("node:path");
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(hit.filePath, destPath);
}
