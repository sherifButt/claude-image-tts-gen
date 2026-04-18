import { GoogleGenAI } from "@google/genai";
import type {
  ImageGenRequest,
  ImageGenResult,
  ImageProvider,
  ProviderId,
} from "./types.js";

export class GoogleProvider implements ImageProvider {
  readonly id: ProviderId = "google";

  private readonly client: GoogleGenAI;

  constructor(opts: { apiKey: string }) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async generateImage(req: ImageGenRequest): Promise<ImageGenResult> {
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
              { text: req.prompt },
            ],
          },
        ]
      : req.prompt;

    const response = await this.client.models.generateContent({
      model: req.model,
      contents: contents as never,
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
}
