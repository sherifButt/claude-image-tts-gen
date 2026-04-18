export type ProviderId = "google" | "openai" | "openrouter" | "elevenlabs";
export type Modality = "image" | "tts";
export type Tier = "small" | "mid" | "pro";

export interface ImageGenRequest {
  prompt: string;
  model: string;
  params?: Record<string, unknown>;
}

export interface ImageGenResult {
  mimeType: string;
  data: Buffer;
  modelUsed: string;
  providerUsed: ProviderId;
}

export interface TtsGenRequest {
  text: string;
  model: string;
  voice?: string;
  params?: Record<string, unknown>;
}

export interface TtsGenResult {
  mimeType: string;
  data: Buffer;
  modelUsed: string;
  providerUsed: ProviderId;
}

export interface ImageProvider {
  readonly id: ProviderId;
  generateImage(req: ImageGenRequest): Promise<ImageGenResult>;
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
