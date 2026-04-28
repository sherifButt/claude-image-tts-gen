#!/usr/bin/env node
import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// src/cli.ts
import { join as join2 } from "node:path";

// src/bootstrap.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var NATIVE_DEP_SENTINELS = [
  "node_modules/onnxruntime-node/package.json",
  "node_modules/sharp/package.json"
];
function ensureNativeDeps(entryUrl) {
  const here = dirname(fileURLToPath(entryUrl));
  const pluginRoot2 = join(here, "..");
  const missing = NATIVE_DEP_SENTINELS.filter(
    (rel) => !existsSync(join(pluginRoot2, rel))
  );
  if (missing.length === 0) return pluginRoot2;
  process.stderr.write(
    "[claude-image-tts-gen] First-time setup: installing native dependencies (~30-60s, one-time)...\n"
  );
  try {
    execSync("npm ci --omit=dev --no-audit --no-fund", {
      cwd: pluginRoot2,
      stdio: "inherit"
    });
  } catch {
    process.stderr.write(
      `[claude-image-tts-gen] Setup failed.
  Manual fix: cd "${pluginRoot2}" && npm ci --omit=dev
  Then restart Claude Code.
`
    );
    process.exit(1);
  }
  process.stderr.write("[claude-image-tts-gen] Setup complete.\n");
  return pluginRoot2;
}

// src/cli.ts
var pluginRoot = ensureNativeDeps(import.meta.url);
var mainPath = join2(pluginRoot, "dist", "cli-main.js");
await import(mainPath);
