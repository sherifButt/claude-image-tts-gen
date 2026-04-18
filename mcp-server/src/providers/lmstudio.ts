import OpenAI, { toFile } from "openai";
import { aspectToOpenAISize } from "../util/aspect.js";
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  ProviderId,
  TtsGenRequest,
  TtsGenResult,
  TtsProvider,
} from "./types.js";

interface LMStudioOptions {
  baseUrl: string;
}

/**
 * LM Studio runs a local OpenAI-compatible API (default http://localhost:1234/v1).
 * Whether image generation and TTS work depends on which models the user has loaded —
 * most LM Studio installs only host text LLMs. Calls will return clean 404/501 errors
 * when the requested capability isn't available locally.
 */
export class LMStudioProvider implements ImageProvider, TtsProvider {
  readonly id: ProviderId = "lmstudio";

  private readonly client: OpenAI;

  constructor(opts: LMStudioOptions) {
    this.client = new OpenAI({
      // LM Studio doesn't validate keys; any non-empty string works.
      apiKey: "lm-studio",
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
      if (!item?.b64_json) {
        throw new Error("LM Studio image edit returned no b64_json data");
      }
      return {
        mimeType: "image/png",
        data: Buffer.from(item.b64_json, "base64"),
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
    if (!item?.b64_json) {
      throw new Error(
        "LM Studio image generation returned no b64_json data — model may not support image output",
      );
    }
    return {
      mimeType: "image/png",
      data: Buffer.from(item.b64_json, "base64"),
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
    return {
      mimeType: "audio/mpeg",
      data,
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }
}

export interface LMStudioModel {
  id: string;
  object?: string;
  /** Naive capability hint based on model id substrings. */
  likelyCapability: "text" | "image" | "tts" | "embedding" | "unknown";
}

interface ModelsListResponse {
  data?: Array<{ id?: string; object?: string }>;
  error?: { message?: string };
}

export async function listLmStudioModels(baseUrl: string): Promise<LMStudioModel[]> {
  const url = baseUrl.endsWith("/") ? `${baseUrl}models` : `${baseUrl}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      throw new Error(`LM Studio /models returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
    const data = (await r.json()) as ModelsListResponse;
    if (data.error?.message) throw new Error(`LM Studio error: ${data.error.message}`);
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

function guessCapability(id: string): LMStudioModel["likelyCapability"] {
  const lower = id.toLowerCase();
  if (/(stable-?diffusion|sdxl|flux|playground|imagen|dall.?e|gpt-image)/.test(lower)) return "image";
  if (/(tts|xtts|bark|coqui|piper|whisper-tts|orpheus)/.test(lower)) return "tts";
  if (/embed/.test(lower)) return "embedding";
  if (/whisper/.test(lower)) return "text"; // STT, not TTS
  return "text";
}
