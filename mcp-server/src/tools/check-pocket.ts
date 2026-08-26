import type { Config } from "../config.js";
import {
  POCKET_TTS_DEFAULT_VOICE,
  POCKET_TTS_VOICES,
  PocketTtsProvider,
} from "../providers/pocket-tts.js";

export interface PocketCheckOutput {
  success: true;
  /** Everything needed to generate is working. */
  ok: boolean;
  baseUrl: string;
  enabled: boolean;
  reachable: boolean;
  /** Can it synthesize with one of the shipped voices? */
  builtInVoices: boolean;
  /** Can it clone from a reference WAV? Independently verified — see below. */
  cloning: boolean;
  cloningDetail: string;
  voices: readonly string[];
  defaultVoice: string;
  latencyMs: number | null;
  /** Actionable next steps for whatever is not working. */
  fixes: string[];
  text: string;
}

/**
 * Full credentials/capability check for pocket-tts, so nothing surprises the
 * caller mid-run.
 *
 * The whole reason this is more than a liveness ping: `/health` answers
 * `{"status":"healthy"}` even when the gated cloning weights failed to load,
 * and the server will then happily narrate in a stranger's voice. The only
 * honest test is to clone something, so this synthesizes one token with a
 * built-in voice and feeds that audio straight back as a cloning reference —
 * self-contained, needs no file from the user, ~0.5s, $0.
 */
export async function checkPocket(config: Config): Promise<PocketCheckOutput> {
  const baseUrl = config.pocketTtsBaseUrl;
  const provider = new PocketTtsProvider({ baseUrl });
  const fixes: string[] = [];

  const started = Date.now();
  const reachable = await provider.health();
  const latencyMs = reachable ? Date.now() - started : null;

  if (!reachable) {
    fixes.push(
      `Start the server: \`pocket-tts serve\` (listens on :8000 by default). Install it with \`pip install pocket-tts\`.`,
    );
    fixes.push(`If it runs elsewhere, set POCKET_TTS_BASE_URL (currently ${baseUrl}).`);
    return render({
      ok: false,
      baseUrl,
      enabled: config.pocketTtsEnabled,
      reachable: false,
      builtInVoices: false,
      cloning: false,
      cloningDetail: "server not reachable",
      latencyMs,
      fixes,
    });
  }

  const clone = await provider.probeCloning();
  // probeCloning synthesizes with a built-in voice first, so a failure there
  // is reported as a built-in failure rather than a cloning one.
  const builtInVoices = clone.ok || !clone.detail.startsWith("built-in voice synthesis failed");
  const cloning = clone.ok;

  if (!builtInVoices) {
    fixes.push(`Built-in voice synthesis failed (${clone.detail}). Check the pocket-tts server log.`);
  } else if (!cloning) {
    fixes.push(
      "Voice cloning is unavailable — the weights are a gated HuggingFace repo. Accept the terms at https://huggingface.co/kyutai/pocket-tts, run `hf auth login`, then restart the server.",
    );
    fixes.push(
      "Until then, built-in voices still work. generate_speech will REFUSE a cloning request rather than quietly substituting a stock voice.",
    );
  }

  if (!config.pocketTtsEnabled) {
    fixes.push(
      "Reachable but not enabled for automatic selection. Set POCKET_TTS_ENABLED=true, or just pass --provider pocket-tts explicitly (always allowed).",
    );
  }

  return render({
    ok: builtInVoices,
    baseUrl,
    enabled: config.pocketTtsEnabled,
    reachable: true,
    builtInVoices,
    cloning,
    cloningDetail: clone.detail,
    latencyMs,
    fixes,
  });
}

function render(o: {
  ok: boolean;
  baseUrl: string;
  enabled: boolean;
  reachable: boolean;
  builtInVoices: boolean;
  cloning: boolean;
  cloningDetail: string;
  latencyMs: number | null;
  fixes: string[];
}): PocketCheckOutput {
  const mark = (b: boolean) => (b ? "OK  " : "FAIL");
  const lines = [
    `pocket-tts @ ${o.baseUrl}${o.latencyMs !== null ? ` (${o.latencyMs}ms)` : ""}`,
    "",
    `  ${mark(o.reachable)}  server reachable`,
    `  ${mark(o.builtInVoices)}  built-in voices (${POCKET_TTS_VOICES.length} available, default "${POCKET_TTS_DEFAULT_VOICE}")`,
    `  ${mark(o.cloning)}  voice cloning — ${o.cloningDetail}`,
    `  ${o.enabled ? "OK  " : "off "}  auto-selection (POCKET_TTS_ENABLED)`,
    "",
    `Cost: $0 — runs locally.`,
  ];
  if (o.fixes.length > 0) {
    lines.push("", "To fix:");
    for (const f of o.fixes) lines.push(`  - ${f}`);
  }
  return {
    success: true,
    ok: o.ok,
    baseUrl: o.baseUrl,
    enabled: o.enabled,
    reachable: o.reachable,
    builtInVoices: o.builtInVoices,
    cloning: o.cloning,
    cloningDetail: o.cloningDetail,
    voices: POCKET_TTS_VOICES,
    defaultVoice: POCKET_TTS_DEFAULT_VOICE,
    latencyMs: o.latencyMs,
    fixes: o.fixes,
    text: lines.join("\n"),
  };
}
