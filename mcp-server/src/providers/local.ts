import OpenAI, { toFile } from "openai";
import { aspectToOpenAISize } from "../util/aspect.js";
import { StructuredError } from "../util/errors.js";
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  ProviderId,
  TtsGenRequest,
  TtsGenResult,
  TtsProvider,
} from "./types.js";

interface LocalOptions {
  baseUrl: string;
}

/**
 * Talks to a local OpenAI-compatible server. Supported backends:
 *
 *   Kokoro-FastAPI   http://localhost:8880/v1   (TTS — recommended default)
 *   Speaches         http://localhost:8000/v1   (TTS + STT)
 *   Orpheus-FastAPI  http://localhost:5005/v1   (Orpheus TTS with emotion tags)
 *   Chatterbox-TTS   http://localhost:4123/v1   (voice cloning, GPU)
 *   LM Studio        http://localhost:1234/v1   (LLM/embeddings only — does
 *                                                NOT expose /v1/audio/speech
 *                                                or /v1/images/generations,
 *                                                despite what the port
 *                                                shares suggest)
 *
 * Any server that implements the OpenAI `/v1/audio/speech` or
 * `/v1/images/generations` wire format will work.
 */
export class LocalProvider implements ImageProvider, TtsProvider {
  readonly id: ProviderId = "local";

  private readonly client: OpenAI;
  private readonly baseUrl: string;

  constructor(opts: LocalOptions) {
    this.baseUrl = opts.baseUrl;
    this.client = new OpenAI({
      // Local servers don't validate keys; any non-empty string works.
      apiKey: "local-server",
      baseURL: opts.baseUrl,
    });
  }

  async generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
    if (req.referenceImage) {
      const ext = (req.referenceImage.mimeType.split("/")[1] ?? "png").replace(
        /[^a-z0-9]/gi,
        "",
      );
      const file = await toFile(req.referenceImage.data, `reference.${ext}`, {
        type: req.referenceImage.mimeType,
      });
      const response = await this.client.images.edit({
        model: req.model,
        image: file,
        prompt: req.prompt,
        n: 1,
      });
      const item = response.data?.[0];
      const data = decodeImageItem(item);
      if (!data) {
        throw noImageEndpointError(this.baseUrl, "edit");
      }
      return {
        mimeType: "image/png",
        data,
        modelUsed: req.model,
        providerUsed: this.id,
      };
    }

    const size = req.aspectRatio ? aspectToOpenAISize(req.aspectRatio) : undefined;
    const response = await this.client.images.generate({
      model: req.model,
      prompt: req.prompt,
      n: 1,
      ...(size ? { size } : {}),
    });
    const item = response.data?.[0];
    const data = decodeImageItem(item);
    if (!data) {
      throw noImageEndpointError(this.baseUrl, "generate");
    }
    return {
      mimeType: "image/png",
      data,
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }

  async generateSpeech(req: TtsGenRequest): Promise<TtsGenResult> {
    const response = await this.client.audio.speech.create({
      model: req.model,
      input: req.text,
      voice: (req.voice ?? "alloy") as "alloy",
      response_format: "mp3",
    });
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < MIN_AUDIO_BYTES) {
      throw noSpeechEndpointError(this.baseUrl, data.length);
    }
    return {
      mimeType: "audio/mpeg",
      data,
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }
}

const MIN_AUDIO_BYTES = 256;

function decodeImageItem(
  item: { b64_json?: string } | undefined,
): Buffer | null {
  if (!item?.b64_json) return null;
  const buf = Buffer.from(item.b64_json, "base64");
  return buf.length > 0 ? buf : null;
}

function noSpeechEndpointError(baseUrl: string, byteLen: number): StructuredError {
  return new StructuredError(
    "CONFIG_ERROR",
    `Local server at ${baseUrl} returned ${byteLen} bytes on /v1/audio/speech — the endpoint is not implemented there`,
    `LM Studio does not expose /v1/audio/speech. Run Kokoro-FastAPI instead:
  docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
then set LOCAL_BASE_URL=http://localhost:8880/v1. Alternatives: Speaches (kokoro + whisper), Orpheus-FastAPI, Chatterbox-TTS-API.`,
  );
}

function noImageEndpointError(baseUrl: string, verb: "generate" | "edit"): StructuredError {
  return new StructuredError(
    "CONFIG_ERROR",
    `Local server at ${baseUrl} returned no image bytes on /v1/images/${verb} — the endpoint is not implemented there`,
    `LM Studio does not expose /v1/images/generations. To serve image models locally, run an OpenAI-compatible image server (e.g. SD.Next with its OpenAI shim) and point LOCAL_BASE_URL at it. For cheap cloud-image without a local server, use --provider google (free default).`,
  );
}

export interface LocalModel {
  id: string;
  object?: string;
  /** Naive capability hint based on model id substrings. */
  likelyCapability: "text" | "image" | "tts" | "embedding" | "unknown";
}

interface ModelsListResponse {
  data?: Array<{ id?: string; object?: string }>;
  error?: { message?: string };
}

export async function listLocalModels(baseUrl: string): Promise<LocalModel[]> {
  const url = baseUrl.endsWith("/") ? `${baseUrl}models` : `${baseUrl}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      throw new Error(`Local /models returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const data = (await r.json()) as ModelsListResponse;
    if (data.error?.message) throw new Error(`Local error: ${data.error.message}`);
    const items = data.data ?? [];
    return items
      .filter((m) => typeof m.id === "string")
      .map((m) => ({
        id: m.id!,
        object: m.object,
        likelyCapability: guessCapability(m.id!),
      }));
  } finally {
    clearTimeout(timer);
  }
}

function guessCapability(id: string): LocalModel["likelyCapability"] {
  const lower = id.toLowerCase();
  if (/(kokoro|orpheus|xtts|chatterbox|piper|bark|coqui|tts)/.test(lower)) return "tts";
  if (/(stable-?diffusion|sdxl|flux|playground|imagen|dall.?e|gpt-image)/.test(lower)) return "image";
  if (/embed/.test(lower)) return "embedding";
  if (/whisper/.test(lower)) return "text"; // STT, not TTS
  return "text";
}
