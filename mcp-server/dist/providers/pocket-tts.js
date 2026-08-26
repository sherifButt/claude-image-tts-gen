import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { StructuredError } from "../util/errors.js";
/**
 * KYUTAI POCKET-TTS — a second free TTS engine alongside Voicebox and `local`.
 *
 * Adapted from the demo-reel plugin, which added it because Voicebox was the
 * only $0 provider and therefore a single point of failure. pocket-tts is a
 * plain pip package rather than a self-unpacking bundle, so it cannot fail the
 * way Voicebox does (answering HTTP while every generation dies). Licence is
 * clean for client work: MIT code, CC-BY-4.0 weights.
 *
 * Measured locally: ~4x realtime on CPU, 24 kHz mono WAV out.
 *
 * ## IT MUST REFUSE WHEN IT CANNOT CLONE
 *
 * The upstream library does this on ANY weights-download failure — expired
 * token, revoked gate, no network:
 *
 *     try:    weights = download(config.weights_path)              # with cloning
 *     except: has_voice_cloning = False
 *             weights = download(config.weights_path_without_voice_cloning)
 *
 * It does not fail. It quietly loads the model that CANNOT clone and then
 * speaks in a stranger's voice. `/health` still answers `{"status":"healthy"}`
 * throughout — verified against a live server — so nothing downstream would
 * notice until someone listened to the output. That is the same class of silent
 * degradation this repo refuses elsewhere, so the error is translated into a
 * refusal that names the gate and the fix rather than passed through raw.
 *
 * `check_pocket` probes this ahead of time precisely so it does not surface
 * mid-run. See tools/check-pocket.ts.
 */
/** A long line on CPU is a few seconds, but a cold server loads the model on
 *  its first request. */
const REQUEST_TIMEOUT_MS = 5 * 60_000;
/**
 * The catalogue shipped with the model. These are named voices, not clones —
 * useful for narration where no specific voice is wanted, and the only thing
 * available when the cloning weights are missing.
 */
export const POCKET_TTS_VOICES = [
    "alba", "cosette", "marius", "javert", "jean", "anna", "vera", "fantine",
    "charles", "paul", "eponine", "azelma", "george", "mary", "jane", "michael",
    "eve", "bill_boerst", "peter_yearsley", "stuart_bell", "caro_davy",
    "giovanni", "lola", "juergen", "rafael", "estelle",
];
export const POCKET_TTS_DEFAULT_VOICE = "alba";
export function isPocketBuiltInVoice(v) {
    return POCKET_TTS_VOICES.includes(v);
}
/**
 * The voice identifier that reaches the cache key.
 *
 * A built-in name is stable and returned unchanged. A reference WAV becomes
 * `<path>#<sha16 of its bytes>`: pocket-tts clones from a file, and a file can
 * be re-recorded in place, keeping its path while changing every sample. Keyed
 * by path alone, a stale cache hit would narrate in the previous voice and
 * nothing would say so.
 */
export function resolvePocketVoice(voiceId) {
    if (!voiceId)
        return null;
    if (isPocketBuiltInVoice(voiceId))
        return voiceId;
    if (!existsSync(voiceId)) {
        throw new StructuredError("NOT_FOUND", `pocket-tts voice "${voiceId}" is neither a built-in voice nor a file that exists`, `Point --voice at a clean reference .wav to clone from, or use one of: ${POCKET_TTS_VOICES.slice(0, 6).join(", ")}, … (run check_pocket for the full list).`);
    }
    const digest = createHash("sha256").update(readFileSync(voiceId)).digest("hex").slice(0, 16);
    return `${voiceId}#${digest}`;
}
/** Split `<path>#<digest>` back into the path the request needs. */
export function pocketReferencePath(voice) {
    const at = voice.lastIndexOf("#");
    return at > 0 ? voice.slice(0, at) : voice;
}
/** Buffer is typed over ArrayBufferLike, which Blob won't take. A plain view
 *  over the same bytes satisfies the DOM types without copying. */
function toBlobPart(b) {
    return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
/** True when the server's error means "the gated cloning weights are missing". */
export function isCloningUnavailableError(body) {
    return /voice cloning/i.test(body);
}
export function cloningUnavailableError() {
    return new StructuredError("PROVIDER_ERROR", "pocket-tts loaded the model WITHOUT voice cloning, so it cannot speak in the requested voice", "Its cloning weights are a gated repo: accept the terms at https://huggingface.co/kyutai/pocket-tts, run `hf auth login`, then restart the server. Refusing rather than generating — without cloning it would answer in one of its stock voices and nothing downstream would notice.");
}
/**
 * Kyutai pocket-tts, via its own `pocket-tts serve` HTTP API.
 *
 * One endpoint: `POST /tts`, multipart, with either `voice_url` (a built-in
 * name) or `voice_wav` (a reference file, uploaded). Streams a WAV back.
 */
export class PocketTtsProvider {
    id = "pocket-tts";
    baseUrl;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    }
    async generateSpeech(req) {
        // Cloning can be requested two ways: an explicit referenceAudio (the
        // repo-wide cloning arg) or a --voice that points at a file rather than
        // naming a built-in. referenceAudio wins when both are present.
        const referencePath = req.referenceAudio?.path;
        const voice = req.voice ?? POCKET_TTS_DEFAULT_VOICE;
        const form = new FormData();
        form.set("text", req.text);
        if (referencePath || !isPocketBuiltInVoice(voice)) {
            const path = pocketReferencePath(referencePath ?? voice);
            if (!existsSync(path)) {
                throw new StructuredError("NOT_FOUND", `pocket-tts reference "${path}" is gone`, "It is the voice this audio clones from — restore the file, or pass a built-in voice name instead.");
            }
            /*
             * UPLOADED, not referenced by path. The server may not share a
             * filesystem with us, and `voice_url` only accepts http/https/hf or a
             * built-in name, so a local file has no other way in.
             */
            const bytes = req.referenceAudio?.data ?? readFileSync(path);
            form.set("voice_wav", new Blob([toBlobPart(bytes)], { type: "audio/wav" }), basename(path));
        }
        else {
            form.set("voice_url", voice);
        }
        let res;
        try {
            res = await fetch(`${this.baseUrl}/tts`, {
                method: "POST",
                body: form,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        }
        catch (e) {
            throw new StructuredError("PROVIDER_ERROR", `pocket-tts is not reachable at ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`, "Start it with `pocket-tts serve` (listens on :8000 by default), or set POCKET_TTS_BASE_URL. Run check_pocket to confirm what is working.");
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            if (isCloningUnavailableError(body))
                throw cloningUnavailableError();
            throw new StructuredError("PROVIDER_ERROR", `pocket-tts returned ${res.status}: ${body.slice(0, 300)}`, "Check the pocket-tts server log, or run check_pocket for a full status report.");
        }
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length < 1024) {
            throw new StructuredError("PROVIDER_ERROR", `pocket-tts returned ${data.length} bytes — too short to be audio`, "Check the server log; a very short input line can also produce this.");
        }
        return {
            mimeType: "audio/wav",
            data,
            modelUsed: req.model || "pocket-tts",
            providerUsed: this.id,
        };
    }
    /** Is the server answering at all? Note this says nothing about cloning —
     *  `/health` reports healthy even when the cloning weights failed to load. */
    async health() {
        try {
            const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
            return r.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Synthesize a token of speech and hand the result straight back as a
     * cloning reference. Self-contained on purpose: the only honest way to know
     * whether cloning works is to try it, and this needs no file from the user.
     * Costs ~0.5s and $0 (local). Returns null when cloning is unavailable.
     */
    async probeCloning() {
        let seed;
        try {
            const form = new FormData();
            form.set("text", "ok");
            form.set("voice_url", POCKET_TTS_DEFAULT_VOICE);
            const r = await fetch(`${this.baseUrl}/tts`, {
                method: "POST",
                body: form,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!r.ok) {
                return { ok: false, detail: `built-in voice synthesis failed (${r.status})` };
            }
            seed = Buffer.from(await r.arrayBuffer());
        }
        catch (e) {
            return { ok: false, detail: e instanceof Error ? e.message : String(e) };
        }
        try {
            const form = new FormData();
            form.set("text", "ok");
            form.set("voice_wav", new Blob([toBlobPart(seed)], { type: "audio/wav" }), "probe.wav");
            const r = await fetch(`${this.baseUrl}/tts`, {
                method: "POST",
                body: form,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (r.ok)
                return { ok: true, detail: "cloned a reference successfully" };
            const body = await r.text().catch(() => "");
            return {
                ok: false,
                detail: isCloningUnavailableError(body)
                    ? "server loaded the model WITHOUT cloning weights (gated HF repo)"
                    : `clone request failed (${r.status}): ${body.slice(0, 160)}`,
            };
        }
        catch (e) {
            return { ok: false, detail: e instanceof Error ? e.message : String(e) };
        }
    }
}
