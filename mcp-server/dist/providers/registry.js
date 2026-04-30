import { requireElevenLabsKey, requireGeminiKey, requireOpenAIKey, requireOpenRouterKey, } from "../config.js";
import { StructuredError } from "../util/errors.js";
import { ELEVENLABS_DEFAULT_VOICE, ELEVENLABS_FRIENDLY_VOICES, ElevenLabsProvider, } from "./elevenlabs.js";
import { GEMINI_DEFAULT_VOICE, GEMINI_TTS_VOICES, GoogleProvider, } from "./google.js";
import { LocalProvider } from "./local.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import { VoiceboxProvider } from "./voicebox.js";
import { OPENAI_TTS_VOICES_GPT4O, OPENAI_TTS_VOICES_STD, } from "./types.js";
const NA = { model: null, batchable: false, implemented: false };
const MATRIX = [
    {
        id: "google",
        image: {
            small: { model: "gemini-2.5-flash-image", batchable: true, implemented: true },
            mid: NA,
            pro: { model: "imagen-4.0-generate-001", batchable: false, implemented: true },
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
            mid: NA,
            pro: {
                model: "gemini-2.5-pro-preview-tts",
                batchable: true,
                implemented: true,
                voices: GEMINI_TTS_VOICES,
                defaultVoice: GEMINI_DEFAULT_VOICE,
                maxCharsPerCall: 4000,
            },
        },
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
    },
    {
        id: "openrouter",
        image: {
            small: { model: "google/gemini-2.5-flash-image", batchable: false, implemented: true },
            mid: NA,
            pro: { model: "google/gemini-3-pro-image-preview", batchable: false, implemented: true },
        },
        tts: { small: NA, mid: NA, pro: NA },
    },
    {
        id: "local",
        // Local server capabilities depend on which backend is running
        // (Kokoro-FastAPI for TTS, SD.Next for image, etc.). All slots NA:
        // usable only via explicit --model. check_local lists what's available.
        image: { small: NA, mid: NA, pro: NA },
        tts: { small: NA, mid: NA, pro: NA },
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
    },
];
const DEFAULT_PROVIDER = {
    image: "google",
    tts: "google",
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
    const out = [];
    for (const entry of MATRIX) {
        for (const tier of ["small", "mid", "pro"]) {
            const slot = entry[modality][tier];
            if (slot.model && slot.implemented) {
                out.push({
                    provider: entry.id,
                    tier,
                    model: slot.model,
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
    const out = [];
    for (const entry of MATRIX) {
        for (const tier of ["small", "mid", "pro"]) {
            const slot = entry[modality][tier];
            if (slot.model) {
                out.push({
                    provider: entry.id,
                    tier,
                    model: slot.model,
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
        case "openrouter":
            throw new Error("openrouter does not support TTS");
    }
}
