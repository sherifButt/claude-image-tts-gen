/**
 * Voicebox engine capability matrix.
 *
 * Voicebox's API doesn't expose engine capabilities — we hand-maintain this
 * table from the project's docs/source. Re-verify when bumping the
 * `last_verified` date or when Voicebox ships new engines.
 *
 * Source: https://github.com/jamiepine/voicebox README, last verified
 * 2026-04-27 against Voicebox 0.4.x.
 */
const CHATTERBOX_TURBO_TAGS = [
    "[laugh]",
    "[chuckle]",
    "[gasp]",
    "[cough]",
    "[sigh]",
    "[groan]",
    "[sniff]",
    "[shush]",
    "[clear throat]",
];
export const VOICEBOX_ENGINE_CAPABILITIES = {
    qwen: {
        id: "qwen",
        label: "Qwen3-TTS",
        voiceCloning: true,
        emotionTags: { supported: false, tags: [] },
        instructField: true,
        languageCount: 10,
        tradeoff: "0.6B / 1.7B sizes; voice cloning + delivery instructions ('speak slowly', 'whisper').",
    },
    qwen_custom_voice: {
        id: "qwen_custom_voice",
        label: "Qwen CustomVoice",
        voiceCloning: false,
        emotionTags: { supported: false, tags: [] },
        instructField: true,
        languageCount: 10,
        tradeoff: "9 curated preset voices, no reference audio. Natural-language delivery control.",
    },
    chatterbox: {
        id: "chatterbox",
        label: "Chatterbox Multilingual",
        voiceCloning: false,
        emotionTags: { supported: false, tags: [] },
        instructField: false,
        languageCount: 23,
        tradeoff: "Broadest language coverage. Reads tags literally — pass plain prose.",
    },
    chatterbox_turbo: {
        id: "chatterbox_turbo",
        label: "Chatterbox Turbo",
        voiceCloning: false,
        emotionTags: { supported: true, tags: CHATTERBOX_TURBO_TAGS },
        instructField: false,
        languageCount: 1,
        tradeoff: "Fast 350M, English only. Supports paralinguistic tags inline.",
    },
    luxtts: {
        id: "luxtts",
        label: "LuxTTS",
        voiceCloning: false,
        emotionTags: { supported: false, tags: [] },
        instructField: false,
        languageCount: 1,
        tradeoff: "Lightweight ~1GB VRAM, 48kHz output, 150x realtime on CPU. English.",
    },
    tada: {
        id: "tada",
        label: "TADA (HumeAI)",
        voiceCloning: false,
        emotionTags: { supported: false, tags: [] },
        instructField: false,
        languageCount: 10,
        tradeoff: "1B / 3B sizes, 700s+ coherent audio. Reads tags literally.",
    },
    kokoro: {
        id: "kokoro",
        label: "Kokoro",
        voiceCloning: false,
        emotionTags: { supported: false, tags: [] },
        instructField: false,
        languageCount: 8,
        tradeoff: "Tiny 82M, fast CPU inference. 50 curated preset voices.",
    },
};
export const VOICEBOX_CAPABILITIES_LAST_VERIFIED = "2026-04-27";
/**
 * Pick the best engine for a stated need. Returns null when no engine in
 * the matrix matches all the requested capabilities — caller should
 * surface the matrix so the user can pick manually.
 */
export function recommendEngine(need) {
    const candidates = Object.values(VOICEBOX_ENGINE_CAPABILITIES).filter((e) => {
        if (need.voiceCloning && !e.voiceCloning)
            return false;
        if (need.emotionTags && !e.emotionTags.supported)
            return false;
        if (need.instructField && !e.instructField)
            return false;
        return true;
    });
    if (candidates.length === 0)
        return null;
    // Prefer engines with the broadest language coverage when no specific
    // capability narrows the field — gives the user the most flexibility.
    candidates.sort((a, b) => b.languageCount - a.languageCount);
    const winner = candidates[0];
    const reasons = [];
    if (need.voiceCloning)
        reasons.push("voice cloning");
    if (need.emotionTags)
        reasons.push(`tags ${winner.emotionTags.tags.join(" ")}`);
    if (need.instructField)
        reasons.push("instruct field for delivery hints");
    return {
        engineId: winner.id,
        reason: reasons.length > 0 ? reasons.join(" + ") : "broadest language coverage",
    };
}
