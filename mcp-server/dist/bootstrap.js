import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const NATIVE_DEP_SENTINELS = [
    "node_modules/onnxruntime-node/package.json",
    "node_modules/sharp/package.json",
];
export function ensureNativeDeps(entryUrl) {
    const here = dirname(fileURLToPath(entryUrl));
    const pluginRoot = join(here, "..");
    const missing = NATIVE_DEP_SENTINELS.filter((rel) => !existsSync(join(pluginRoot, rel)));
    if (missing.length === 0)
        return pluginRoot;
    process.stderr.write("[claude-image-tts-gen] First-time setup: installing native dependencies (~30-60s, one-time)...\n");
    try {
        execSync("npm ci --omit=dev --no-audit --no-fund", {
            cwd: pluginRoot,
            stdio: "inherit",
        });
    }
    catch {
        process.stderr.write(`[claude-image-tts-gen] Setup failed.\n` +
            `  Manual fix: cd "${pluginRoot}" && npm ci --omit=dev\n` +
            `  Then restart Claude Code.\n`);
        process.exit(1);
    }
    process.stderr.write("[claude-image-tts-gen] Setup complete.\n");
    return pluginRoot;
}
