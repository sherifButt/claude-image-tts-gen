import { GoogleGenAI } from "@google/genai";
import type { Modality, ProviderId } from "../providers/types.js";
import type { BatchProvider } from "./provider.js";
import type { BatchPollResult, BatchPrompt, BatchStatus, BatchSubmitResult } from "./types.js";

interface GoogleBatchOptions {
  apiKey: string;
}

export class GoogleImageBatchProvider implements BatchProvider {
  readonly id: ProviderId = "google";
  readonly modality: Modality = "image";

  private readonly client: GoogleGenAI;

  constructor(opts: GoogleBatchOptions) {
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async submit(prompts: BatchPrompt[], model: string): Promise<BatchSubmitResult> {
    const inlinedRequests = prompts.map((p) => ({
      contents: [{ parts: [{ text: p.text }] }],
    }));

    const batches = (this.client as unknown as { batches?: BatchesApi }).batches;
    if (!batches?.create) {
      throw new Error(
        "@google/genai SDK does not expose batches.create — upgrade the SDK or implement REST fallback",
      );
    }
    const op = await batches.create({
      model,
      src: inlinedRequests,
    });

    const providerJobId = op?.name;
    if (!providerJobId || typeof providerJobId !== "string") {
      throw new Error(`Google batch submit returned no operation name: ${JSON.stringify(op)}`);
    }
    return { providerJobId };
  }

  async poll(providerJobId: string): Promise<BatchPollResult> {
    const batches = (this.client as unknown as { batches?: BatchesApi }).batches;
    if (!batches?.get) {
      throw new Error(
        "@google/genai SDK does not expose batches.get — upgrade the SDK or implement REST fallback",
      );
    }
    const op = await batches.get({ name: providerJobId });
    const status = mapStatus(op);

    if (status !== "completed" && status !== "partial_failure" && status !== "failed") {
      return { status };
    }

    const inlined = op?.dest?.inlinedResponses ?? [];
    const results: BatchPollResult["results"] = [];
    let firstError: string | undefined;

    inlined.forEach((entry, idx) => {
      if (entry?.error?.message) {
        if (!firstError) firstError = entry.error.message;
        return;
      }
      const parts = entry?.response?.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inline = part?.inlineData;
        if (inline?.data && typeof inline.mimeType === "string" && inline.mimeType.startsWith("image/")) {
          results.push({
            customId: `prompt-${idx}`,
            mimeType: inline.mimeType,
            data: Buffer.from(inline.data, "base64"),
          });
          return;
        }
      }
    });

    const finalStatus: BatchStatus =
      status === "completed" && firstError && results.length === 0
        ? "failed"
        : status === "completed" && firstError
          ? "partial_failure"
          : status;

    return {
      status: finalStatus,
      results,
      errorMessage: firstError ?? (status === "failed" ? (op?.error?.message ?? "batch failed") : undefined),
    };
  }
}

function mapStatus(op: BatchJobResponse | undefined): BatchStatus {
  if (!op) return "in_progress";
  const state = op.state;
  if (state === "JOB_STATE_SUCCEEDED") return "completed";
  if (state === "JOB_STATE_FAILED") return "failed";
  if (state === "JOB_STATE_CANCELLED") return "cancelled";
  if (state === "JOB_STATE_EXPIRED") return "expired";
  return "in_progress";
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  }>;
}

interface InlinedResponseEntry {
  response?: GeminiResponse;
  error?: { message?: string };
}

interface BatchJobResponse {
  name?: string;
  state?: string;
  error?: { message?: string };
  dest?: { inlinedResponses?: InlinedResponseEntry[] };
}

interface BatchesApi {
  create?: (req: { model: string; src: unknown }) => Promise<BatchJobResponse>;
  get?: (req: { name: string }) => Promise<BatchJobResponse>;
}
