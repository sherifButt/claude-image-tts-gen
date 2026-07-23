export type ProviderId =
  | "google"
  | "openai"
  | "openrouter"
  | "elevenlabs"
  | "local"
  | "voicebox"
  | "replicate";
export type Modality = "image" | "tts" | "video";
export type Tier = "small" | "mid" | "pro";

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

export interface VideoGenRequest {
  prompt: string;
  model: string;
  /** Image-to-video input frame. grok-imagine-video-1.5 is image-to-video only:
   *  every prediction needs an input image. */
  image: ReferenceImage;
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
