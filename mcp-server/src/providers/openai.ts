import OpenAI from "openai";
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  ProviderId,
  TtsGenRequest,
  TtsGenResult,
  TtsProvider,
} from "./types.js";

type ImageQuality = "low" | "medium" | "high" | "auto";
type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "auto";
type AudioFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

const DEFAULT_VOICE = "alloy";
const DEFAULT_AUDIO_FORMAT: AudioFormat = "mp3";

export class OpenAIProvider implements ImageProvider, TtsProvider {
  readonly id: ProviderId = "openai";

  private readonly client: OpenAI;

  constructor(opts: { apiKey: string }) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
  }

  async generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
    const params = req.params ?? {};
    const quality = (params.quality as ImageQuality | undefined) ?? "auto";
    const size = (params.size as ImageSize | undefined) ?? "auto";

    const response = await this.client.images.generate({
      model: req.model,
      prompt: req.prompt,
      quality,
      size,
      n: 1,
    });

    const item = response.data?.[0];
    if (!item?.b64_json) {
      throw new Error("OpenAI image API returned no b64_json data");
    }

    return {
      mimeType: "image/png",
      data: Buffer.from(item.b64_json, "base64"),
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }

  async generateSpeech(req: TtsGenRequest): Promise<TtsGenResult> {
    const params = req.params ?? {};
    const format = (params.format as AudioFormat | undefined) ?? DEFAULT_AUDIO_FORMAT;
    const voice = req.voice ?? DEFAULT_VOICE;

    const response = await this.client.audio.speech.create({
      model: req.model,
      input: req.text,
      voice,
      response_format: format,
    });

    const buf = Buffer.from(await response.arrayBuffer());
    const mimeType = audioFormatToMime(format);

    return {
      mimeType,
      data: buf,
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }
}

function audioFormatToMime(format: AudioFormat): string {
  switch (format) {
    case "mp3":
      return "audio/mpeg";
    case "opus":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
  }
}
