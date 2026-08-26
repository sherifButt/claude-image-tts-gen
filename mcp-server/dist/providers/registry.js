import { requireElevenLabsKey, requireGeminiKey, requireOpenAIKey, requireOpenRouterKey, requireReplicateToken, } from "../config.js";
import { StructuredError } from "../util/errors.js";
import { ELEVENLABS_DEFAULT_VOICE, ELEVENLABS_FRIENDLY_VOICES, ElevenLabsProvider, } from "./elevenlabs.js";
import { GEMINI_DEFAULT_VOICE, GEMINI_TTS_VOICES, GoogleProvider, } from "./google.js";
import { LocalProvider } from "./local.js";
import { POCKET_TTS_DEFAULT_VOICE, POCKET_TTS_VOICES, PocketTtsProvider, } from "./pocket-tts.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import { ReplicateProvider } from "./replicate.js";
import { VoiceboxProvider } from "./voicebox.js";
import { OPENAI_TTS_VOICES_GPT4O, OPENAI_TTS_VOICES_STD, } from "./types.js";
const NA = { model: null, batchable: false, implemented: false };
const NA_TABLE = { small: NA, mid: NA, pro: NA };
const MATRIX = [
    {
        id: "google",
        image: {
            // small = the cheapest GA option (Nano Banana 2 Lite, ~$0.034/img),
            // honoring the cheapest-by-default rule. gemini-2.5-flash-image stays
            // usable via explicit --model (its pricing entry is retained).
            small: { model: "gemini-3.1-flash-lite-image", batchable: true, implemented: true },
            mid: { model: "gemini-3.1-flash-image", batchable: true, implemented: true },
            // pro was imagen-4.0-generate-001 until Imagen 4's 2026-08-17 shutdown.
            // Google's recommended replacement is the GA Gemini image family; we use
            // Gemini 3 Pro Image ("Nano Banana Pro"), which runs on the same
            // generateContent path as the small/mid slots (no Imagen code path).
            pro: { model: "gemini-3-pro-image", batchable: true, implemented: true },
        },
        tts: {
            small: {
                model: "gemini-2.5-flash-preview-tts",
                batchable: true,
                implemented: true,
                voices: GEMINI_TTS_VOICES,
                defaultVoice: GEMINI_DEFAULT_VOICE,
                // Gemini TTS accepts prompts up to ~8k tokens; chunk well under that in chars.
                maxCharsPerCall: 4000,
            },
            mid: {
                // Gemini 3.1 Flash TTS (preview) — newer flash-tier TTS. Same voice
                // list as the 2.5 models; ~$20/M output (same as pro tier).
                model: "gemini-3.1-flash-tts-preview",
                batchable: true,
                implemented: true,
                voices: GEMINI_TTS_VOICES,
                defaultVoice: GEMINI_DEFAULT_VOICE,
                maxCharsPerCall: 4000,
            },
            pro: {
                model: "gemini-2.5-pro-preview-tts",
                batchable: true,
                implemented: true,
                voices: GEMINI_TTS_VOICES,
                defaultVoice: GEMINI_DEFAULT_VOICE,
                maxCharsPerCall: 4000,
            },
        },
        video: NA_TABLE,
    },
    {
        id: "openai",
        image: {
            small: {
                model: "gpt-image-2",
                batchable: true,
                implemented: true,
                params: { quality: "low" },
            },
            mid: {
                model: "gpt-image-2",
                batchable: true,
                implemented: true,
                params: { quality: "medium" },
            },
            pro: {
                model: "gpt-image-2",
                batchable: true,
                implemented: true,
                params: { quality: "high" },
            },
        },
        tts: {
            small: {
                model: "tts-1",
                batchable: false,
                implemented: true,
                voices: OPENAI_TTS_VOICES_STD,
                defaultVoice: "alloy",
                maxCharsPerCall: 4096,
            },
            mid: {
                model: "gpt-4o-mini-tts",
                batchable: false,
                implemented: true,
                voices: OPENAI_TTS_VOICES_GPT4O,
                defaultVoice: "alloy",
                maxCharsPerCall: 4096,
            },
            pro: {
                model: "tts-1-hd",
                batchable: false,
                implemented: true,
                voices: OPENAI_TTS_VOICES_STD,
                defaultVoice: "alloy",
                maxCharsPerCall: 4096,
            },
        },
        video: NA_TABLE,
    },
    {
        id: "openrouter",
        image: {
            small: { model: "google/gemini-2.5-flash-image", batchable: false, implemented: true },
            mid: { model: "google/gemini-3.1-flash-image-preview", batchable: false, implemented: true },
            pro: { model: "google/gemini-3-pro-image-preview", batchable: false, implemented: true },
        },
        tts: { small: NA, mid: NA, pro: NA },
        video: NA_TABLE,
    },
    {
        id: "local",
        // Local server capabilities depend on which backend is running
        // (Kokoro-FastAPI for TTS, SD.Next for image, etc.). All slots NA:
        // usable only via explicit --model. check_local lists what's available.
        image: { small: NA, mid: NA, pro: NA },
        tts: { small: NA, mid: NA, pro: NA },
        video: NA_TABLE,
    },
    {
        id: "voicebox",
        // Voicebox is local TTS only (custom REST API, voicebox.sh).
        // The 7 engines (qwen, luxtts, chatterbox, kokoro, ...) are bound to
        // each profile, not to the tier — exposing one slot lets callers pick
        // engine via params.engine when they want to override.
        image: { small: NA, mid: NA, pro: NA },
        tts: {
            small: {
                // The model field is informational here — engine + size live in
                // params and are decided by the profile. "voicebox" is the label
                // that appears in cost ledgers and sidecars.
                model: "voicebox",
                batchable: false,
                implemented: true,
                voices: [],
                defaultVoice: undefined,
                customVoicesAllowed: true,
                // Voicebox accepts up to 50k chars per request, but the neural
                // engines (Qwen3-TTS, Chatterbox, ...) degrade in prosody and
                // pacing past ~300 chars per call. Chunk small + stitch via the
                // existing sentence-aware splitter. Voicebox is $0/call so the
                // extra round-trips have no cost; only quality matters here.
                // Override per-call with maxCharsPerChunk if your engine handles
                // longer inputs cleanly.
                maxCharsPerCall: 300,
            },
            mid: NA,
            pro: NA,
        },
        video: NA_TABLE,
    },
    {
        id: "pocket-tts",
        // Kyutai pocket-tts — local, $0, and the second cloning-capable backend
        // after `local`. One slot: the model is fixed, and the "tier" axis has
        // nothing to vary. `voices` are the 26 built-in names; a --voice that is
        // a path to a .wav clones from it instead.
        image: { small: NA, mid: NA, pro: NA },
        tts: {
            small: {
                model: "pocket-tts",
                batchable: false,
                implemented: true,
                voices: POCKET_TTS_VOICES,
                defaultVoice: POCKET_TTS_DEFAULT_VOICE,
                // A reference-wav path is a legal voice here, so names are not a
                // closed set.
                customVoicesAllowed: true,
                // ~4x realtime on CPU. Long inputs work but drift in prosody, and
                // it is $0 per call, so chunk small and stitch — same reasoning as
                // Voicebox.
                maxCharsPerCall: 400,
            },
            mid: NA,
            pro: NA,
        },
        video: NA_TABLE,
    },
    {
        id: "elevenlabs",
        image: { small: NA, mid: NA, pro: NA },
        tts: {
            small: {
                model: "eleven_turbo_v2_5",
                batchable: false,
                implemented: true,
                voices: ELEVENLABS_FRIENDLY_VOICES,
                defaultVoice: ELEVENLABS_DEFAULT_VOICE,
                customVoicesAllowed: true,
                maxCharsPerCall: 5000,
            },
            mid: {
                model: "eleven_multilingual_v2",
                batchable: false,
                implemented: true,
                voices: ELEVENLABS_FRIENDLY_VOICES,
                defaultVoice: ELEVENLABS_DEFAULT_VOICE,
                customVoicesAllowed: true,
                maxCharsPerCall: 5000,
            },
            pro: {
                model: "eleven_v3",
                batchable: false,
                implemented: true,
                voices: ELEVENLABS_FRIENDLY_VOICES,
                defaultVoice: ELEVENLABS_DEFAULT_VOICE,
                customVoicesAllowed: true,
                // v3 supports up to 10k chars per call per ElevenLabs blog; keep
                // conservative 5000 limit so the chunker still splits long inputs
                // and the plugin's INPUT_TOO_LONG catch handles edge cases.
                maxCharsPerCall: 5000,
            },
        },
        video: NA_TABLE,
    },
    {
        id: "replicate",
        // Replicate is video-only in this plugin. Its video slots live in
        // VIDEO_TIERS below rather than here — the ladder spans two models with
        // different length caps and input requirements, which a three-slot
        // TierTable can't express. `listAvailable("video")` reads that table, so
        // estimate_cost / list_providers still see every rung.
        image: NA_TABLE,
        tts: NA_TABLE,
        video: NA_TABLE,
    },
];
const DEFAULT_PROVIDER = {
    image: "google",
    tts: "google",
    video: "replicate",
};
const DEFAULT_TIER = "small";
export function getDefaultProvider(modality) {
    return DEFAULT_PROVIDER[modality];
}
export function getDefaultTier() {
    return DEFAULT_TIER;
}
function tiersImplementedBy(providerId, modality) {
    const entry = MATRIX.find((e) => e.id === providerId);
    if (!entry)
        return [];
    return ["small", "mid", "pro"].filter((t) => entry[modality][t].model !== null && entry[modality][t].implemented);
}
function providersImplementingTier(modality, tier) {
    return MATRIX.filter((e) => {
        const slot = e[modality][tier];
        return slot.model !== null && slot.implemented;
    }).map((e) => e.id);
}
export function resolveSlot(opts) {
    const entry = MATRIX.find((e) => e.id === opts.provider);
    if (!entry) {
        throw new StructuredError("VALIDATION_ERROR", `Unknown provider: ${opts.provider}`, "Run list_providers to see valid provider ids.");
    }
    const slot = entry[opts.modality][opts.tier];
    if (!slot.model) {
        const availableTiers = tiersImplementedBy(opts.provider, opts.modality);
        const providersForTier = providersImplementingTier(opts.modality, opts.tier);
        throw new StructuredError("VALIDATION_ERROR", `${opts.provider} does not offer ${opts.modality} at ${opts.tier} tier`, availableTiers.length > 0
            ? `Try ${opts.provider} at tier ${availableTiers.join(" or ")}, or switch provider to ${providersForTier.join(" / ") || "another"}.`
            : `${opts.provider} has no implemented ${opts.modality} slots. Try providers: ${providersForTier.join(", ") || "(none)"}.`, undefined, { availableTiers, providersForTier });
    }
    if (!slot.implemented) {
        const availableTiers = tiersImplementedBy(opts.provider, opts.modality);
        const providersForTier = providersImplementingTier(opts.modality, opts.tier);
        throw new StructuredError("VALIDATION_ERROR", `${opts.provider} ${opts.modality} ${opts.tier} (${slot.model}) is declared but not yet implemented`, `Use ${opts.provider}/${availableTiers.join("|") || "(none implemented)"} or switch provider to ${providersForTier.join(" / ") || "another"}.`, undefined, { availableTiers, providersForTier });
    }
    return {
        provider: opts.provider,
        modality: opts.modality,
        tier: opts.tier,
        model: slot.model,
        batchable: slot.batchable,
        params: slot.params ?? {},
        voices: slot.voices ?? [],
        defaultVoice: slot.defaultVoice,
        customVoicesAllowed: slot.customVoicesAllowed ?? false,
        maxCharsPerCall: slot.maxCharsPerCall,
    };
}
export function listAvailable(modality) {
    // Video lives in its own ladder, not the three-slot TierTable. Reading it
    // here keeps estimate_cost / list_providers seeing every rung, and hands
    // back the real params so callers never re-derive them (estimate_cost used
    // to hardcode its own tier→resolution map, which drifted the moment the
    // ladder grew).
    if (modality === "video") {
        return ["draft", "low", "normal", "high", "ultra"].map((tier) => {
            const slot = resolveVideoSlot(tier);
            return {
                provider: slot.provider,
                tier,
                model: slot.model,
                params: slot.params,
                batchable: false,
                voices: [],
                defaultVoice: undefined,
                customVoicesAllowed: false,
            };
        });
    }
    const out = [];
    for (const entry of MATRIX) {
        for (const tier of ["small", "mid", "pro"]) {
            const slot = entry[modality][tier];
            if (slot.model && slot.implemented) {
                out.push({
                    provider: entry.id,
                    tier,
                    model: slot.model,
                    params: slot.params ?? {},
                    batchable: slot.batchable,
                    voices: slot.voices ?? [],
                    defaultVoice: slot.defaultVoice,
                    customVoicesAllowed: slot.customVoicesAllowed ?? false,
                });
            }
        }
    }
    return out;
}
export function listDeclared(modality) {
    // Video's rungs live in VIDEO_TIERS, and every one of them is implemented.
    if (modality === "video") {
        return listAvailable("video").map((s) => ({ ...s, implemented: true }));
    }
    const out = [];
    for (const entry of MATRIX) {
        for (const tier of ["small", "mid", "pro"]) {
            const slot = entry[modality][tier];
            if (slot.model) {
                out.push({
                    provider: entry.id,
                    tier,
                    model: slot.model,
                    params: slot.params ?? {},
                    batchable: slot.batchable,
                    voices: slot.voices ?? [],
                    defaultVoice: slot.defaultVoice,
                    customVoicesAllowed: slot.customVoicesAllowed ?? false,
                    implemented: slot.implemented,
                });
            }
        }
    }
    return out;
}
export function createImageProvider(id, config) {
    switch (id) {
        case "google":
            return new GoogleProvider({ apiKey: requireGeminiKey(config) });
        case "openai":
            return new OpenAIProvider({ apiKey: requireOpenAIKey(config) });
        case "openrouter":
            return new OpenRouterProvider({ apiKey: requireOpenRouterKey(config) });
        case "local":
            return new LocalProvider({ baseUrl: config.localBaseUrl });
        case "elevenlabs":
        case "voicebox":
        case "pocket-tts":
        case "replicate":
            throw new Error(`${id} image provider is declared in the registry but not yet implemented`);
    }
}
export function createTtsProvider(id, config) {
    switch (id) {
        case "google":
            return new GoogleProvider({ apiKey: requireGeminiKey(config) });
        case "openai":
            return new OpenAIProvider({ apiKey: requireOpenAIKey(config) });
        case "elevenlabs":
            return new ElevenLabsProvider({ apiKey: requireElevenLabsKey(config) });
        case "local":
            return new LocalProvider({ baseUrl: config.localBaseUrl });
        case "voicebox":
            return new VoiceboxProvider({ baseUrl: config.voiceboxBaseUrl });
        case "pocket-tts":
            return new PocketTtsProvider({ baseUrl: config.pocketTtsBaseUrl });
        case "openrouter":
            throw new Error("openrouter does not support TTS");
        case "replicate":
            throw new Error("replicate does not support TTS (video-only in this plugin)");
    }
}
export function createVideoProvider(id, config) {
    switch (id) {
        case "replicate":
            return new ReplicateProvider({ apiToken: requireReplicateToken(config) });
        case "google":
        case "openai":
        case "openrouter":
        case "elevenlabs":
        case "local":
        case "voicebox":
        case "pocket-tts":
            throw new StructuredError("VALIDATION_ERROR", `${id} does not support video generation`, "Use --provider replicate for video (grok-imagine-video-1.5).");
    }
}
/**
 * Motion-video ladder — `generate_video`. Deliberately the same five rungs as
 * AVATAR_TIERS: p-video on draft/low/normal, a specialist on high/ultra. Here
 * the specialist is `xai/grok-imagine-video-1.5`, whose motion is richer than
 * p-video's but which costs 2–7x more and cannot work without an input frame.
 *
 * p-video params match the avatar ladder's, for the same reasons (see
 * AVATAR_TIERS): fps 48, no server-side prompt rewriting, safety filter on.
 */
const VIDEO_TIERS = {
    draft: {
        model: "prunaai/p-video",
        params: {
            resolution: "720p",
            fps: 48,
            draft: true,
            prompt_upsampling: false,
            disable_safety_filter: false,
        },
        maxDurationSeconds: 20,
        requiresImage: false,
    },
    low: {
        model: "prunaai/p-video",
        params: {
            resolution: "720p",
            fps: 48,
            draft: false,
            prompt_upsampling: false,
            disable_safety_filter: false,
        },
        maxDurationSeconds: 20,
        requiresImage: false,
    },
    normal: {
        model: "prunaai/p-video",
        params: {
            resolution: "1080p",
            fps: 48,
            draft: false,
            prompt_upsampling: false,
            disable_safety_filter: false,
        },
        maxDurationSeconds: 20,
        requiresImage: false,
    },
    high: {
        model: "xai/grok-imagine-video-1.5",
        params: { resolution: "480p" },
        maxDurationSeconds: 15,
        requiresImage: true,
    },
    ultra: {
        model: "xai/grok-imagine-video-1.5",
        params: { resolution: "720p" },
        maxDurationSeconds: 15,
        requiresImage: true,
    },
};
const VIDEO_RATES = {
    draft: 0.005,
    low: 0.02,
    normal: 0.04,
    high: 0.08,
    ultra: 0.14,
};
export const DEFAULT_VIDEO_TIER = "normal";
const LEGACY_VIDEO_TIERS = { small: "high", mid: "ultra" };
export function normalizeVideoTier(tier) {
    return LEGACY_VIDEO_TIERS[tier] ?? tier;
}
export function videoRate(tier) {
    return VIDEO_RATES[tier];
}
export function resolveVideoSlot(tier) {
    const resolved = normalizeVideoTier(tier);
    const slot = VIDEO_TIERS[resolved];
    if (!slot) {
        throw new StructuredError("VALIDATION_ERROR", `unknown video tier "${tier}"`, "Use draft ($0.005/s), low ($0.02/s), normal ($0.04/s), high ($0.08/s) or ultra ($0.14/s). draft/low/normal also do text-to-video; high/ultra need an input frame.");
    }
    return {
        provider: "replicate",
        model: slot.model,
        tier: resolved,
        params: { ...slot.params },
        maxDurationSeconds: slot.maxDurationSeconds,
        requiresImage: slot.requiresImage,
    };
}
/**
 * Talking-avatar (lip-sync) ladder — image + audio → video. Two models:
 * p-video for the cheap rungs and VEED Fabric for the long/high-fidelity ones.
 * Kept out of the video `TierTable` because that maps one model across tiers;
 * here the tier axis switches model, resolution, and length ceiling at once.
 *
 * p-video pins two params away from the model's own defaults: prompt_upsampling
 * off (an LLM rewriting the prompt server-side would make the sidecar stop
 * describing what was generated) and the safety filter on (it ships off, which
 * is not a default to inherit silently for a tool that animates real faces).
 */
const AVATAR_TIERS = {
    draft: {
        model: "prunaai/p-video",
        params: {
            resolution: "720p",
            fps: 48,
            draft: true,
            prompt_upsampling: false,
            disable_safety_filter: false,
        },
        maxAudioSeconds: 20,
        needsPrompt: true,
    },
    low: {
        model: "prunaai/p-video",
        params: {
            resolution: "720p",
            fps: 48,
            draft: false,
            prompt_upsampling: false,
            disable_safety_filter: false,
        },
        maxAudioSeconds: 20,
        needsPrompt: true,
    },
    normal: {
        model: "prunaai/p-video",
        params: {
            resolution: "1080p",
            fps: 48,
            draft: false,
            prompt_upsampling: false,
            disable_safety_filter: false,
        },
        maxAudioSeconds: 20,
        needsPrompt: true,
    },
    high: {
        model: "veed/fabric-1.0",
        params: { resolution: "480p" },
        maxAudioSeconds: null,
        needsPrompt: false,
    },
    ultra: {
        model: "veed/fabric-1.0",
        params: { resolution: "720p" },
        maxAudioSeconds: null,
        needsPrompt: false,
    },
};
/** Per-second rates, for error/help text only — pricing.json stays authoritative. */
const AVATAR_RATES = {
    draft: 0.005,
    low: 0.02,
    normal: 0.04,
    high: 0.08,
    ultra: 0.15,
};
export const DEFAULT_AVATAR_TIER = "normal";
/** Pre-ladder sidecars say small/mid and must still resolve to Fabric. */
const LEGACY_AVATAR_TIERS = { small: "high", mid: "ultra" };
export function normalizeAvatarTier(tier) {
    return LEGACY_AVATAR_TIERS[tier] ?? tier;
}
export function avatarRate(tier) {
    return AVATAR_RATES[tier];
}
export function resolveAvatarSlot(tier) {
    const resolved = normalizeAvatarTier(tier);
    const slot = AVATAR_TIERS[resolved];
    if (!slot) {
        throw new StructuredError("VALIDATION_ERROR", `unknown talking-avatar tier "${tier}"`, "Use draft ($0.005/s), low ($0.02/s), normal ($0.04/s), high ($0.08/s) or ultra ($0.15/s). draft/low/normal cap the audio at 20s.");
    }
    return {
        provider: "replicate",
        model: slot.model,
        tier: resolved,
        params: { ...slot.params },
        maxAudioSeconds: slot.maxAudioSeconds,
        needsPrompt: slot.needsPrompt,
    };
}
export function createAvatarProvider(id, config) {
    switch (id) {
        case "replicate":
            return new ReplicateProvider({ apiToken: requireReplicateToken(config) });
        case "google":
        case "openai":
        case "openrouter":
        case "elevenlabs":
        case "local":
        case "voicebox":
        case "pocket-tts":
            throw new StructuredError("VALIDATION_ERROR", `${id} does not support talking-avatar generation`, "Use --provider replicate for talking avatars (veed/fabric-1.0).");
    }
}
