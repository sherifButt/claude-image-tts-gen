import type { Config } from "../config.js";
import { getStaleness } from "../pricing/load.js";
import type { Staleness } from "../pricing/types.js";
import type { ProviderId } from "../providers/types.js";

export interface ProviderHealth {
  configured: boolean;
  ok: boolean | null;
  latencyMs: number | null;
  error: string | null;
}

export interface HealthCheckOutput {
  success: true;
  ok: boolean;
  pricing: Staleness;
  providers: Record<ProviderId, ProviderHealth>;
  text: string;
}

const PING_TIMEOUT_MS = 8000;

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

async function pingGoogle(apiKey: string): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } finally {
    clearTimeout(t);
  }
}

async function pingOpenAI(apiKey: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } finally {
    clearTimeout(t);
  }
}

async function pingOpenRouter(apiKey: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } finally {
    clearTimeout(t);
  }
}

async function pingElevenLabs(apiKey: string): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": apiKey },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } finally {
    clearTimeout(t);
  }
}

async function checkProvider(
  configured: boolean,
  apiKey: string | undefined,
  pinger: (key: string) => Promise<void>,
): Promise<ProviderHealth> {
  if (!configured || !apiKey) {
    return { configured: false, ok: null, latencyMs: null, error: null };
  }
  try {
    const { latencyMs } = await timed(() => pinger(apiKey));
    return { configured: true, ok: true, latencyMs, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { configured: true, ok: false, latencyMs: null, error };
  }
}

export async function healthCheck(config: Config): Promise<HealthCheckOutput> {
  const [google, openai, openrouter, elevenlabs] = await Promise.all([
    checkProvider(Boolean(config.geminiApiKey), config.geminiApiKey, pingGoogle),
    checkProvider(Boolean(config.openaiApiKey), config.openaiApiKey, pingOpenAI),
    checkProvider(Boolean(config.openrouterApiKey), config.openrouterApiKey, pingOpenRouter),
    checkProvider(Boolean(config.elevenlabsApiKey), config.elevenlabsApiKey, pingElevenLabs),
  ]);

  const pricing = getStaleness();
  const configured = [google, openai, openrouter, elevenlabs].filter((p) => p.configured);
  const allOk = configured.length > 0 && configured.every((p) => p.ok === true) && !pricing.isStale;

  return {
    success: true,
    ok: allOk,
    pricing,
    providers: { google, openai, openrouter, elevenlabs },
    text: renderText({ google, openai, openrouter, elevenlabs }, pricing),
  };
}

function renderText(
  providers: Record<ProviderId, ProviderHealth>,
  pricing: Staleness,
): string {
  const lines = [`Health check:`, ``, `Providers:`];
  for (const [id, h] of Object.entries(providers)) {
    if (!h.configured) {
      lines.push(`  ${id.padEnd(12)} not configured (no API key set)`);
      continue;
    }
    if (h.ok) {
      lines.push(`  ${id.padEnd(12)} OK (${h.latencyMs}ms)`);
    } else {
      lines.push(`  ${id.padEnd(12)} FAIL — ${h.error}`);
    }
  }
  lines.push(``, `Pricing:`);
  lines.push(
    `  last_updated: ${pricing.lastUpdated} (${pricing.daysAgo} days ago)` +
      (pricing.isStale ? ` — STALE (>${pricing.threshold}d)` : ` — fresh`),
  );
  return lines.join("\n");
}
