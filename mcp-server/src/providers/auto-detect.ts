import type { Config } from "../config.js";

const PROBE_TIMEOUT_MS = 800;

async function probe(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: "GET", signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function probeVoicebox(baseUrl: string): Promise<boolean> {
  return probe(`${baseUrl.replace(/\/$/, "")}/health`);
}

export async function probeLocal(baseUrl: string): Promise<boolean> {
  return probe(`${baseUrl.replace(/\/$/, "")}/models`);
}

function log(config: Config, level: "info" | "debug", msg: string): void {
  const ranks = { error: 0, warn: 1, info: 2, debug: 3 };
  if (ranks[level] <= ranks[config.logLevel]) {
    process.stderr.write(`[claude-image-tts-gen] ${msg}\n`);
  }
}

/**
 * Probe localhost endpoints in parallel. For each provider whose env flag
 * was unset (autoProbe=true), flip its `enabled` flag to true if the probe
 * succeeds. Explicit `*_ENABLED=true|false` values are respected without
 * probing — we never override user intent.
 *
 * Mutates config in place. Logs the resolution at info level so users see
 * which providers came online.
 */
export async function applyAutoDetection(config: Config): Promise<void> {
  const tasks: Array<Promise<void>> = [];

  if (config.voiceboxAutoProbe) {
    tasks.push(
      probeVoicebox(config.voiceboxBaseUrl).then((reachable) => {
        if (reachable) {
          config.voiceboxEnabled = true;
          log(
            config,
            "info",
            `voicebox: auto-detected at ${config.voiceboxBaseUrl} (set VOICEBOX_ENABLED=false to opt out)`,
          );
        } else {
          log(config, "debug", `voicebox: not reachable at ${config.voiceboxBaseUrl}, skipping`);
        }
      }),
    );
  }

  if (config.localAutoProbe) {
    tasks.push(
      probeLocal(config.localBaseUrl).then((reachable) => {
        if (reachable) {
          config.localEnabled = true;
          log(
            config,
            "info",
            `local: auto-detected at ${config.localBaseUrl} (set LOCAL_ENABLED=false to opt out)`,
          );
        } else {
          log(config, "debug", `local: not reachable at ${config.localBaseUrl}, skipping`);
        }
      }),
    );
  }

  await Promise.all(tasks);
}
