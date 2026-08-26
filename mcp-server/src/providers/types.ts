export type ProviderId =
  | "google"
  | "openai"
  | "openrouter"
  | "elevenlabs"
  | "local"
  | "voicebox"
  | "pocket-tts"
  | "replicate";
export type Modality = "image" | "tts" | "video";
export type Tier = "small" | "mid" | "pro";
/**
 * Talking-avatar quality ladder. Wider than the shared image/tts/video `Tier`
 * because avatars span two models with very different economics: p-video
 * (draft/low/normal — fast, cheap, capped at 20s of audio) and VEED Fabric
 * (high/ultra — dedicated lip-sync, no length cap). Ordered cheapest-first.
 * `small`/`mid` are accepted as deprecated aliases for `high`/`ultra` so
 * sidecars written before this ladder existed still regenerate to Fabric.
 */
export type AvatarTier = "draft" | "low" | "normal" | "high" | "ultra";
export type AvatarTierInput = AvatarTier | "small" | "mid";

/**
 * Motion-video quality ladder. Same five words as `AvatarTier` on purpose —
 * both tools share `prunaai/p-video` on draft/low/normal and switch to a
 * specialist model on high/ultra (grok for motion, fabric for lip-sync), so
 * the vocabulary is worth learning once. `small`/`mid` are deprecated aliases
 * for `high`/`ultra` (grok 480p/720p), which is what pre-ladder video sidecars
 * recorded.
 */
export type VideoTier = "draft" | "low" | "normal" | "high" | "ultra";
export type VideoTierInput = VideoTier | "small" | "mid";

const TIERS: readonly string[] = ["small", "mid", "pro"];

/**
 * Narrow a sidecar/ledger tier back to the shared image/tts/video `Tier`.
 * Those records carry `Tier | AvatarTier` because avatars share the field, but
 * an avatar-only rung can never appear on an image/speech/video sidecar — the
 * `tool` field already discriminates. The fallback is for hand-edited files.
 */
export function asTier(tier: Tier | AvatarTier, fallback: Tier = "small"): Tier {
  return TIERS.includes(tier) ? (tier as Tier) : fallback;
}

const AVATAR_TIER_INPUTS: readonly string[] = [
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
export function asAvatarTier(
  tier: Tier | AvatarTier,
  fallback: AvatarTierInput = "high",
): AvatarTierInput {
  return AVATAR_TIER_INPUTS.includes(tier) ? (tier as AvatarTierInput) : fallback;
}

export interface ReferenceImage {
  data: Buffer;
  mimeType: string;
  path?: string;
}

export interface ImageGenRequest {
  prompt: string;
  model: string;
  params?: Record<string, unknown>;
  /** Reference images for image-to-image or multi-reference composition.
   *  Order matters for providers that condition on each in sequence
   *  (e.g. Gemini multimodal). Undefined or empty → text-only generation. */
  referenceImages?: ReferenceImage[];
  aspectRatio?: import("../util/aspect.js").AspectRatio;
  /** Output resolution tier (gpt-image-2 only: 1K default / 2K / 4K). Other
   *  providers ignore it. Combined with aspectRatio to pick a concrete size. */
  resolution?: import("../util/aspect.js").ImageResolution;
  /** Exact gpt-image-2 output size "WIDTHxHEIGHT" (overrides resolution +
   *  aspectRatio). Must satisfy gpt-image-2's size constraints. openai only. */
  size?: string;
  /** Background handling (gpt-image-2 / gpt-image-1 family): auto (default),
   *  opaque, or transparent. Transparent is unsupported on gpt-image-2. */
  background?: "auto" | "opaque" | "transparent";
}

export interface ImageGenResult {
  mimeType: string;
  data: Buffer;
  modelUsed: string;
  providerUsed: ProviderId;
}

export interface ReferenceAudio {
  data: Buffer;
  mimeType: string;
  /** Absolute filesystem path, when available — some local backends prefer a
   *  path over inlined base64. */
  path?: string;
}

export interface TtsGenRequest {
  text: string;
  model: string;
  voice?: string;
  params?: Record<string, unknown>;
  /** Request word-level alignment data when the provider supports it. */
  wantTimestamps?: boolean;
  /** Reference audio for zero-shot voice cloning (local Chatterbox / XTTS). */
  referenceAudio?: ReferenceAudio;
}

export interface WordAlignment {
  word: string;
  /** Seconds from start of this audio. */
  start: number;
  end: number;
}

export interface TtsGenResult {
  mimeType: string;
  data: Buffer;
  modelUsed: string;
  providerUsed: ProviderId;
  /** Present only when the provider returns alignment (e.g. ElevenLabs with-timestamps). */
  alignment?: WordAlignment[];
}

const VIDEO_TIER_INPUTS: readonly string[] = [
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
export function asVideoTier(
  tier: Tier | AvatarTier | VideoTier,
  fallback: VideoTierInput = "high",
): VideoTierInput {
  return VIDEO_TIER_INPUTS.includes(tier) ? (tier as VideoTierInput) : fallback;
}

export interface VideoGenRequest {
  prompt: string;
  model: string;
  /** Input frame. Required by grok (image-to-video only); optional on
   *  p-video, where omitting it means text-to-video from the prompt. */
  image?: ReferenceImage;
  /** Additional reference images for composition (grok accepts up to 7 total,
   *  including `image`). Order matters. */
  referenceImages?: ReferenceImage[];
  params?: Record<string, unknown>;
  /** Requested clip length in seconds. Drives per-second cost. */
  durationSeconds: number;
  /** Output aspect ratio; omit for the provider's "auto". */
  aspectRatio?: import("../util/aspect.js").AspectRatio;
}

export interface VideoGenResult {
  mimeType: string;
  data: Buffer;
  modelUsed: string;
  providerUsed: ProviderId;
  /** Actual clip length billed, in seconds. Falls back to the requested duration. */
  durationSeconds: number;
}

export interface ImageProvider {
  readonly id: ProviderId;
  generateImage(req: ImageGenRequest): Promise<ImageGenResult>;
}

export interface VideoProvider {
  readonly id: ProviderId;
  generateVideo(req: VideoGenRequest): Promise<VideoGenResult>;
}

export interface AvatarGenRequest {
  model: string;
  /** The avatar / person / illustration to animate (jpg/png). */
  image: ReferenceImage;
  /** The speech audio the mouth + head are lip-synced to (mp3/wav/m4a/aac). */
  audio: ReferenceAudio;
  /** Motion prompt. Required by p-video (which is a general video model with
   *  audio conditioning); Fabric ignores it — the audio alone drives that one. */
  prompt?: string;
  params?: Record<string, unknown>;
  /** Output length in seconds (= the audio's duration). Drives per-second cost. */
  durationSeconds: number;
}

export interface AvatarGenResult {
  mimeType: string;
  data: Buffer;
  modelUsed: string;
  providerUsed: ProviderId;
  durationSeconds: number;
}

/** Talking-avatar / lip-sync video: image + audio → video (VEED Fabric). */
export interface AvatarProvider {
  readonly id: ProviderId;
  generateAvatar(req: AvatarGenRequest): Promise<AvatarGenResult>;
}

export interface TtsProvider {
  readonly id: ProviderId;
  generateSpeech(req: TtsGenRequest): Promise<TtsGenResult>;
}

export const OPENAI_TTS_VOICES_STD = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

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
] as const;
