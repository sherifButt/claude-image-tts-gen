import OpenAI, { toFile } from "openai";
import { aspectToOpenAISize, aspectToOpenAISizeAtResolution } from "../util/aspect.js";
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
// gpt-image-1 sizes plus gpt-image-2's higher-resolution buckets (2K/4K).
// gpt-image-2 accepts any WIDTHxHEIGHT satisfying its constraints; we pass a
// resolved bucket string, so the type stays a string at the API boundary.
type ImageSize = string;
type ImageBackground = "auto" | "opaque" | "transparent";
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
    // Resolution (gpt-image-2 2K/4K) needs an explicit WIDTHxHEIGHT — "auto"
    // yields ~1K. For 2K/4K, resolve a concrete bucket from the aspect (square
    // when none given). 1K keeps legacy behavior (aspect bucket, else auto).
    // An explicit custom size wins over the resolution/aspect mapping.
    const highRes = req.resolution && req.resolution !== "1K";
    const size: ImageSize = req.size
      ? req.size
      : highRes
        ? aspectToOpenAISizeAtResolution(req.aspectRatio ?? "1:1", req.resolution!)
        : req.aspectRatio
          ? aspectToOpenAISize(req.aspectRatio)
          : ((params.size as ImageSize | undefined) ?? "auto");

    const background = req.background as ImageBackground | undefined;
    // gpt-image-2 rejects transparent; fail fast with a clear message rather
    // than spending a round-trip on a guaranteed API error.
    if (background === "transparent" && req.model.toLowerCase().startsWith("gpt-image-2")) {
      throw new Error(
        "gpt-image-2 does not support background: 'transparent'. Use 'opaque'/'auto', " +
          "or --model gpt-image-1 (which supports transparent PNG output).",
      );
    }

    let item;
    const refs = req.referenceImages ?? [];
    if (refs.length > 0) {
      const files = await Promise.all(
        refs.map(async (ref, idx) => {
          const ext = (ref.mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "");
          const filename = `reference-${idx}.${ext === "jpeg" ? "png" : ext}`;
          return await toFile(ref.data, filename, { type: ref.mimeType });
        }),
      );
      const response = await this.client.images.edit({
        model: req.model,
        image: files.length === 1 ? files[0] : files,
        prompt: req.prompt,
        n: 1,
        size,
        quality,
        ...(background ? { background } : {}),
      });
      item = response.data?.[0];
    } else {
      const response = await this.client.images.generate({
        model: req.model,
        prompt: req.prompt,
        quality,
        size,
        n: 1,
        ...(background ? { background } : {}),
      });
      item = response.data?.[0];
    }

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
