const TIERS = ["small", "mid", "pro"];
/**
 * Narrow a sidecar/ledger tier back to the shared image/tts/video `Tier`.
 * Those records carry `Tier | AvatarTier` because avatars share the field, but
 * an avatar-only rung can never appear on an image/speech/video sidecar — the
 * `tool` field already discriminates. The fallback is for hand-edited files.
 */
export function asTier(tier, fallback = "small") {
    return TIERS.includes(tier) ? tier : fallback;
}
const AVATAR_TIER_INPUTS = [
    "draft",
    "low",
    "normal",
    "high",
    "ultra",
    "small",
    "mid",
];
/** Counterpart of {@link asTier} for the avatar branch. "pro" is the only
 *  value that can't appear on an avatar sidecar; it falls back to Fabric 480p. */
export function asAvatarTier(tier, fallback = "high") {
    return AVATAR_TIER_INPUTS.includes(tier) ? tier : fallback;
}
const VIDEO_TIER_INPUTS = [
    "draft",
    "low",
    "normal",
    "high",
    "ultra",
    "small",
    "mid",
];
/** Narrow a sidecar/ledger tier to the video ladder. "pro" never appears on a
 *  video sidecar; it falls back to grok 480p, the pre-ladder default. */
export function asVideoTier(tier, fallback = "high") {
    return VIDEO_TIER_INPUTS.includes(tier) ? tier : fallback;
}
export const OPENAI_TTS_VOICES_STD = [
    "alloy",
    "echo",
    "fable",
    "onyx",
    "nova",
    "shimmer",
];
export const OPENAI_TTS_VOICES_GPT4O = [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
];
