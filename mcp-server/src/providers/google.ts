import { GoogleGenAI, Modality } from "@google/genai";
import { aspectToImagen, injectAspectIntoPrompt } from "../util/aspect.js";
import { pcmToWav, parseSampleRate } from "../util/wav.js";
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  ProviderId,
  TtsGenRequest,
  TtsGenResult,
  TtsProvider,
} from "./types.js";

/** Gemini TTS prebuilt voices (as of v2.5-*-tts). */
export const GEMINI_TTS_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;

export const GEMINI_DEFAULT_VOICE = "Kore";

export class GoogleProvider implements ImageProvider, TtsProvider {
  readonly id: ProviderId = "google";

  private readonly client: GoogleGenAI;

  constructor(opts: { apiKey: string }) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
    if (isImagenModel(req.model)) {
      return await this.generateImageViaImagen(req);
    }
    return await this.generateImageViaGemini(req);
  }

  private async generateImageViaImagen(req: ImageGenRequest): Promise<ImageGenResult> {
    if (req.referenceImage) {
      // Imagen 4 generate doesn't accept input images. Point the caller at the
      // Gemini Flash multimodal path (or editImage) explicitly.
      throw new Error(
        "Imagen 4 does not accept reference images for generation. Use gemini-2.5-flash-image for image-to-image, or call images.edit separately.",
      );
    }

    const response = await this.client.models.generateImages({
      model: req.model,
      prompt: req.prompt,
      config: {
        numberOfImages: 1,
        ...(req.aspectRatio ? { aspectRatio: aspectToImagen(req.aspectRatio) } : {}),
      },
    });

    const first = response.generatedImages?.[0]?.image;
    if (!first?.imageBytes) {
      const filtered = response.generatedImages?.[0]?.raiFilteredReason;
      throw new Error(
        filtered
          ? `Imagen filtered the output: ${filtered}`
          : "Imagen returned no image data",
      );
    }
    return {
      mimeType: first.mimeType ?? "image/png",
      data: Buffer.from(first.imageBytes, "base64"),
      modelUsed: req.model,
      providerUsed: this.id,
    };
  }

  private async generateImageViaGemini(req: ImageGenRequest): Promise<ImageGenResult> {
    const effectivePrompt = req.aspectRatio
      ? injectAspectIntoPrompt(req.prompt, req.aspectRatio)
      : req.prompt;

    const contents = req.referenceImage
      ? [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: req.referenceImage.mimeType,
                  data: req.referenceImage.data.toString("base64"),
                },
              },
              { text: effectivePrompt },
            ],
          },
        ]
      : effectivePrompt;

    const config = req.aspectRatio
      ? { imageConfig: { aspectRatio: req.aspectRatio } }
      : undefined;

    const response = await this.client.models.generateContent({
      model: req.model,
      contents: contents as never,
      ...(config ? { config: config as never } : {}),
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("image/")) {
        return {
          mimeType: inline.mimeType,
          data: Buffer.from(inline.data, "base64"),
          modelUsed: req.model,
          providerUsed: this.id,
        };
      }
    }

    const textParts = parts
      .map((p) => p.text)
      .filter((t): t is string => typeof t === "string");
    const reason = textParts.length > 0 ? textParts.join(" ") : "no image in response";
    throw new Error(`Gemini returned no image data (${reason})`);
  }

  async generateSpeech(req: TtsGenRequest): Promise<TtsGenResult> {
    const voice = req.voice ?? GEMINI_DEFAULT_VOICE;

    const response = await this.client.models.generateContent({
      model: req.model,
      contents: req.text,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      } as never,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("audio/")) {
        const pcm = Buffer.from(inline.data, "base64");
        const sampleRate = parseSampleRate(inline.mimeType);
        const wav = pcmToWav(pcm, { sampleRate });
        return {
          mimeType: "audio/wav",
          data: wav,
          modelUsed: req.model,
          providerUsed: this.id,
        };
      }
    }

    const textParts = parts
      .map((p) => p.text)
      .filter((t): t is string => typeof t === "string");
    const reason = textParts.length > 0 ? textParts.join(" ") : "no audio in response";
    throw new Error(`Gemini TTS returned no audio data (${reason})`);
  }
}

function isImagenModel(model: string): boolean {
  return model.toLowerCase().startsWith("imagen");
}
