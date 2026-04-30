import { VOICEBOX_CAPABILITIES_LAST_VERIFIED, VOICEBOX_ENGINE_CAPABILITIES, } from "../providers/voicebox-engines.js";
import { listVoiceboxProfiles } from "../providers/voicebox.js";
import { StructuredError } from "../util/errors.js";
const FETCH_TIMEOUT_MS = 5000;
async function fetchJson(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok)
            throw new Error(`${url} ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return (await r.json());
    }
    finally {
        clearTimeout(t);
    }
}
export async function checkVoicebox(config) {
    const baseUrl = config.voiceboxBaseUrl.replace(/\/$/, "");
    let health;
    try {
        health = await fetchJson(`${baseUrl}/health`);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new StructuredError("PROVIDER_ERROR", `Could not reach Voicebox at ${baseUrl}: ${message}`, `Start Voicebox (https://voicebox.sh) or set VOICEBOX_BASE_URL to its base URL. Default port is 17493.`);
    }
    let profiles = [];
    try {
        const raw = await listVoiceboxProfiles(baseUrl);
        profiles = raw.map((p) => ({
            id: p.id,
            name: p.name,
            language: p.language,
            voiceType: p.voice_type,
            defaultEngine: p.default_engine ?? null,
        }));
    }
    catch {
        // Non-fatal — health passed but profiles failed (uncommon).
    }
    // Fetch preset voice counts per engine in parallel. Empty/error → null.
    const engineIds = Object.keys(VOICEBOX_ENGINE_CAPABILITIES);
    const presetCounts = await Promise.all(engineIds.map(async (id) => {
        try {
            const r = await fetchJson(`${baseUrl}/profiles/presets/${id}`);
            return Array.isArray(r.voices) ? r.voices.length : null;
        }
        catch {
            return null;
        }
    }));
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
function renderText(baseUrl, health, profiles, engines) {
    const lines = [];
    lines.push(`Voicebox at ${baseUrl}`);
    const healthBits = [];
    if (health.status)
        healthBits.push(`status=${health.status}`);
    if (health.model_loaded !== undefined)
        healthBits.push(`model_loaded=${health.model_loaded}`);
    if (health.gpu_available !== undefined)
        healthBits.push(`gpu=${health.gpu_available ? (health.gpu_type ?? "yes") : "no"}`);
    if (health.backend_type)
        healthBits.push(`backend=${health.backend_type}`);
    if (healthBits.length > 0)
        lines.push(`  ${healthBits.join("  ")}`);
    lines.push("");
    lines.push(`Profiles (${profiles.length}):`);
    if (profiles.length === 0) {
        lines.push(`  (none — create one in the Voicebox app or POST /profiles)`);
    }
    else {
        for (const p of profiles) {
            const bits = [p.name, p.voiceType, p.language].filter(Boolean).join("  ");
            lines.push(`  ${p.id}  ${bits}${p.defaultEngine ? `  default-engine=${p.defaultEngine}` : ""}`);
        }
    }
    lines.push("");
    lines.push(`Engines (capabilities verified ${VOICEBOX_CAPABILITIES_LAST_VERIFIED}):`);
    for (const e of engines) {
        const flags = [];
        if (e.voiceCloning)
            flags.push("clones");
        if (e.emotionTags.supported)
            flags.push(`tags=${e.emotionTags.tags.join(" ")}`);
        if (e.instructField)
            flags.push("instruct=");
        flags.push(`${e.languageCount}lang`);
        if (e.presetVoiceCount !== null)
            flags.push(`presets=${e.presetVoiceCount}`);
        lines.push(`  ${e.id.padEnd(18)} ${e.label}`);
        lines.push(`    ${flags.join("  ")}`);
        lines.push(`    ${e.tradeoff}`);
    }
    lines.push("");
    lines.push(`Pass an engine via params.engine on generate_speech (e.g. params.engine="chatterbox_turbo" for [laugh]/[sigh] tags).`);
    return lines.join("\n");
}
