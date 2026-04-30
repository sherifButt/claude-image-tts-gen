import { StructuredError } from "../util/errors.js";
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 5 * 60_000;
/**
 * Talks to a local Voicebox server (default port 17493). Voicebox runs a
 * custom REST API — not OpenAI-compatible — so this provider sits next to
 * the `local` adapter rather than reusing it.
 *
 * Flow per generation:
 *   1. POST /generate { profile_id, text, language, engine?, model_size? }
 *      → returns { id } with status "generating"
 *   2. Poll GET /history/{id} until status is "completed" or "failed"
 *   3. GET /audio/{id} → audio/wav bytes
 *
 * Voice selection is by profile_id (UUID), so the registry slot has
 * customVoicesAllowed: true and no curated voice list. Set
 * VOICEBOX_DEFAULT_VOICE to a profile_id to skip --voice on every call.
 */
export class VoiceboxProvider {
    id = "voicebox";
    baseUrl;
    constructor(opts) {
        this.baseUrl = stripTrailingSlash(opts.baseUrl);
    }
    async generateSpeech(req) {
        const profileId = req.voice;
        if (!profileId) {
            throw new StructuredError("VALIDATION_ERROR", "Voicebox requires a profile_id as the voice", `Pass --voice <profile_id> or set VOICEBOX_DEFAULT_VOICE. List profiles with: curl ${this.baseUrl}/profiles`);
        }
        const params = req.params ?? {};
        const engine = params.engine ?? undefined;
        const modelSize = params.model_size ?? undefined;
        const language = params.language ?? "en";
        const body = {
            profile_id: profileId,
            text: req.text,
            language,
        };
        if (engine)
            body.engine = engine;
        if (modelSize)
            body.model_size = modelSize;
        const startRes = await fetch(`${this.baseUrl}/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!startRes.ok) {
            const errBody = (await startRes.text()).slice(0, 500);
            throw new StructuredError("PROVIDER_ERROR", `Voicebox /generate ${startRes.status}: ${errBody}`, `Confirm Voicebox is running at ${this.baseUrl} and the profile_id exists (GET /profiles).`);
        }
        const initial = (await startRes.json());
        if (!initial.id) {
            throw new StructuredError("PROVIDER_ERROR", "Voicebox /generate returned no id", `Hit /docs at ${this.baseUrl}/docs to verify the API.`);
        }
        const final = await this.pollUntilComplete(initial.id);
        const audio = await this.fetchAudio(final.id);
        // Keep modelUsed aligned with the registry slot's model id so the pricing
        // table key (`voicebox/voicebox`) resolves. The actual engine + model_size
        // are captured in the sidecar via params, not the model field.
        return {
            mimeType: "audio/wav",
            data: audio,
            modelUsed: req.model,
            providerUsed: this.id,
        };
    }
    async pollUntilComplete(generationId) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const res = await fetch(`${this.baseUrl}/history/${generationId}`);
            if (!res.ok) {
                const errBody = (await res.text()).slice(0, 300);
                throw new StructuredError("PROVIDER_ERROR", `Voicebox /history/${generationId} ${res.status}: ${errBody}`, `The generation may have been deleted. Re-submit.`);
            }
            const state = (await res.json());
            if (state.status === "completed")
                return state;
            if (state.status === "failed") {
                throw new StructuredError("PROVIDER_ERROR", `Voicebox generation failed: ${state.error ?? "(no error message)"}`, `Check Voicebox logs. Common causes: model not downloaded, GPU OOM, profile sample missing.`);
            }
            await sleep(POLL_INTERVAL_MS);
        }
        throw new StructuredError("PROVIDER_TIMEOUT", `Voicebox generation ${generationId} did not complete within ${POLL_TIMEOUT_MS / 1000}s`, `Long inputs on CPU can exceed this — try shorter text, a smaller model_size, or run Voicebox with GPU acceleration.`);
    }
    async fetchAudio(generationId) {
        const res = await fetch(`${this.baseUrl}/audio/${generationId}`);
        if (!res.ok) {
            const errBody = (await res.text()).slice(0, 300);
            throw new StructuredError("PROVIDER_ERROR", `Voicebox /audio/${generationId} ${res.status}: ${errBody}`, `The generation completed but the audio file is missing on the server side.`);
        }
        return Buffer.from(await res.arrayBuffer());
    }
}
function stripTrailingSlash(url) {
    return url.endsWith("/") ? url.slice(0, -1) : url;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function listVoiceboxProfiles(baseUrl) {
    const url = `${stripTrailingSlash(baseUrl)}/profiles`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) {
            throw new Error(`Voicebox /profiles returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        const data = (await r.json());
        return Array.isArray(data) ? data : [];
    }
    finally {
        clearTimeout(timer);
    }
}
export const VOICEBOX_DEFAULT_PORT = 17493;
export const VOICEBOX_ENGINES = [
    "qwen",
    "qwen_custom_voice",
    "luxtts",
    "chatterbox",
    "chatterbox_turbo",
    "tada",
    "kokoro",
];
