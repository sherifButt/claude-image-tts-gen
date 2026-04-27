import type { Config } from "../config.js";
import {
  VOICEBOX_CAPABILITIES_LAST_VERIFIED,
  VOICEBOX_ENGINE_CAPABILITIES,
  type VoiceboxEngineId,
} from "../providers/voicebox-engines.js";
import { listVoiceboxProfiles } from "../providers/voicebox.js";
import { StructuredError } from "../util/errors.js";

interface VoiceboxHealth {
  status?: string;
  model_loaded?: boolean;
  model_size?: string | null;
  gpu_available?: boolean;
  gpu_type?: string | null;
  backend_type?: string | null;
  backend_variant?: string | null;
}

interface VoiceboxProfileSummary {
  id: string;
  name: string;
  language: string | undefined;
  voiceType: string | undefined;
  defaultEngine: string | undefined;
}

export interface CheckVoiceboxOutput {
  success: true;
  baseUrl: string;
  health: VoiceboxHealth;
  profiles: VoiceboxProfileSummary[];
  engines: Array<{
    id: VoiceboxEngineId;
    label: string;
    voiceCloning: boolean;
    emotionTags: { supported: boolean; tags: readonly string[] };
    instructField: boolean;
    languageCount: number;
    tradeoff: string;
    presetVoiceCount: number | null;
  }>;
  capabilitiesLastVerified: string;
  text: string;
}

const FETCH_TIMEOUT_MS = 5000;

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`${url} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export async function checkVoicebox(config: Config): Promise<CheckVoiceboxOutput> {
  const baseUrl = config.voiceboxBaseUrl.replace(/\/$/, "");

  let health: VoiceboxHealth;
  try {
    health = await fetchJson<VoiceboxHealth>(`${baseUrl}/health`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StructuredError(
      "PROVIDER_ERROR",
      `Could not reach Voicebox at ${baseUrl}: ${message}`,
      `Start Voicebox (https://voicebox.sh) or set VOICEBOX_BASE_URL to its base URL. Default port is 17493.`,
    );
  }

  let profiles: VoiceboxProfileSummary[] = [];
  try {
    const raw = await listVoiceboxProfiles(baseUrl);
    profiles = raw.map((p: any) => ({
      id: p.id,
      name: p.name,
      language: p.language,
      voiceType: p.voice_type,
      defaultEngine: p.default_engine ?? null,
    }));
  } catch {
    // Non-fatal — health passed but profiles failed (uncommon).
  }

  // Fetch preset voice counts per engine in parallel. Empty/error → null.
  const engineIds = Object.keys(VOICEBOX_ENGINE_CAPABILITIES) as VoiceboxEngineId[];
  const presetCounts = await Promise.all(
    engineIds.map(async (id) => {
      try {
        const r = await fetchJson<{ engine: string; voices: unknown[] }>(
          `${baseUrl}/profiles/presets/${id}`,
        );
        return Array.isArray(r.voices) ? r.voices.length : null;
      } catch {
        return null;
      }
    }),
  );

  const engines = engineIds.map((id, i) => {
    const cap = VOICEBOX_ENGINE_CAPABILITIES[id];
    return {
      id,
      label: cap.label,
      voiceCloning: cap.voiceCloning,
      emotionTags: cap.emotionTags,
      instructField: cap.instructField,
      languageCount: cap.languageCount,
      tradeoff: cap.tradeoff,
      presetVoiceCount: presetCounts[i],
    };
  });

  return {
    success: true,
    baseUrl,
    health,
    profiles,
    engines,
    capabilitiesLastVerified: VOICEBOX_CAPABILITIES_LAST_VERIFIED,
    text: renderText(baseUrl, health, profiles, engines),
  };
}

function renderText(
  baseUrl: string,
  health: VoiceboxHealth,
  profiles: VoiceboxProfileSummary[],
  engines: CheckVoiceboxOutput["engines"],
): string {
  const lines: string[] = [];
  lines.push(`Voicebox at ${baseUrl}`);
  const healthBits: string[] = [];
  if (health.status) healthBits.push(`status=${health.status}`);
  if (health.model_loaded !== undefined) healthBits.push(`model_loaded=${health.model_loaded}`);
  if (health.gpu_available !== undefined)
    healthBits.push(`gpu=${health.gpu_available ? (health.gpu_type ?? "yes") : "no"}`);
  if (health.backend_type) healthBits.push(`backend=${health.backend_type}`);
  if (healthBits.length > 0) lines.push(`  ${healthBits.join("  ")}`);

  lines.push("");
  lines.push(`Profiles (${profiles.length}):`);
  if (profiles.length === 0) {
    lines.push(`  (none — create one in the Voicebox app or POST /profiles)`);
  } else {
    for (const p of profiles) {
      const bits = [p.name, p.voiceType, p.language].filter(Boolean).join("  ");
      lines.push(`  ${p.id}  ${bits}${p.defaultEngine ? `  default-engine=${p.defaultEngine}` : ""}`);
    }
  }

  lines.push("");
  lines.push(`Engines (capabilities verified ${VOICEBOX_CAPABILITIES_LAST_VERIFIED}):`);
  for (const e of engines) {
    const flags: string[] = [];
    if (e.voiceCloning) flags.push("clones");
    if (e.emotionTags.supported) flags.push(`tags=${e.emotionTags.tags.join(" ")}`);
    if (e.instructField) flags.push("instruct=");
    flags.push(`${e.languageCount}lang`);
    if (e.presetVoiceCount !== null) flags.push(`presets=${e.presetVoiceCount}`);
    lines.push(`  ${e.id.padEnd(18)} ${e.label}`);
    lines.push(`    ${flags.join("  ")}`);
    lines.push(`    ${e.tradeoff}`);
  }

  lines.push("");
  lines.push(
    `Pass an engine via params.engine on generate_speech (e.g. params.engine="chatterbox_turbo" for [laugh]/[sigh] tags).`,
  );
  return lines.join("\n");
}
