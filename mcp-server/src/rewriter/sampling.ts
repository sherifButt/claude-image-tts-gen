import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ProviderId } from "../providers/types.js";

const PROVIDER_GUIDANCE: Record<ProviderId, string> = {
  google:
    "Gemini image models prefer concise but vivid prose: subject + setting + style + lighting + camera. Avoid bullet lists.",
  openai:
    "gpt-image-1 prefers direct, visual descriptions. Avoid abstract concepts. Specify orientation if relevant.",
  openrouter:
    "Routed via OpenRouter — the upstream model is usually Gemini-style. Concise, vivid, scene-first.",
  elevenlabs: "(no image rewrites for elevenlabs)",
};

const SamplingResultSchema = z.object({
  role: z.string().optional(),
  content: z
    .union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
    ])
    .optional(),
  model: z.string().optional(),
  stopReason: z.string().optional(),
});

export interface RewriteResult {
  rewritten: string;
  usedSampling: true;
}

/**
 * Ask the MCP host to rewrite an image prompt via sampling.
 * Returns null if the client doesn't support sampling, the request fails,
 * or the rewritten output looks suspicious (empty, too long).
 */
export async function rewritePromptViaMcpSampling(
  server: Server,
  prompt: string,
  providerId: ProviderId,
): Promise<RewriteResult | null> {
  if (!prompt || prompt.trim().length === 0) return null;

  const guidance = PROVIDER_GUIDANCE[providerId];
  const system =
    `You rewrite prompts for AI image generation. Output ONLY the rewritten prompt — ` +
    `no preamble, no explanation, no quotes around it. Keep the user's subject and intent intact. ` +
    `Add concrete visual details (lighting, setting, mood, camera) where useful. ` +
    `Maximum 200 words.\n\nProvider guidance: ${guidance}`;

  try {
    const raw = await server.request(
      {
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: { type: "text", text: prompt },
            },
          ],
          systemPrompt: system,
          maxTokens: 400,
          temperature: 0.4,
        },
      },
      SamplingResultSchema,
    );

    const text = extractText(raw.content);
    if (!text) return null;
    const cleaned = text.trim().replace(/^["']|["']$/g, "");
    if (cleaned.length === 0 || cleaned.length > 4000) return null;
    return { rewritten: cleaned, usedSampling: true };
  } catch {
    // Client doesn't support sampling, or call failed — silently fall back.
    return null;
  }
}

function extractText(content: unknown): string | null {
  if (!content) return null;
  if (typeof content === "object" && "text" in (content as Record<string, unknown>)) {
    const t = (content as { text?: unknown }).text;
    return typeof t === "string" ? t : null;
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "text" && typeof part.text === "string") return part.text;
    }
  }
  return null;
}
