// Post-tsc build step: copy non-TS assets into dist/ and prepare entry
// points for execution. Cross-platform (uses Node's fs API).
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// 1. Copy pricing.json next to its compiled load.js so the runtime
//    readFileSync(join(__dirname, "pricing.json")) call resolves.
mkdirSync("dist/pricing", { recursive: true });
copyFileSync("src/pricing/pricing.json", "dist/pricing/pricing.json");

// 2. Prepend a shebang to the entry-point JS files so `npm link`-style
//    bin invocations work, and mark them executable. Server and CLI are
//    normally invoked via `node dist/...js` (Claude Code's MCP launcher
//    + npm scripts) where the shebang is harmless; it only matters if
//    someone installs globally.
const SHEBANG = "#!/usr/bin/env node\n";
const entries = ["dist/server.js", "dist/cli.js", "dist/pricing/refresh.js"];
for (const entry of entries) {
  const body = readFileSync(entry, "utf8");
  if (!body.startsWith("#!")) {
    writeFileSync(entry, SHEBANG + body);
  }
  chmodSync(entry, 0o755);
}
