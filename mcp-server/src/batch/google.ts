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
    const requests = prompts.map((p) => ({
      contents: [{ parts: [{ text: p.text }] }],
    }));

    // The @google/genai SDK exposes batch operations under client.batches
    // Returns an object with .name (the operation resource name)
    const batches = (this.client as unknown as { batches?: BatchesApi }).batches;
    if (!batches?.create) {
      throw new Error(
        "@google/genai SDK does not expose batches.create — upgrade the SDK or implement REST fallback",
      );
    }
    const op = await batches.create({
      model,
      requests,
    });

    const providerJobId = op?.name ?? op?.batchId;
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

    const responses = op?.response?.responses ?? op?.responses ?? [];
    const results: BatchPollResult["results"] = [];

    responses.forEach((resp, idx) => {
      const parts = resp?.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inline = part?.inlineData;
        if (inline?.data && typeof inline.mimeType === "string" && inline.mimeType.startsWith("image/")) {
          results.push({
            customId: `${idx}`,
            mimeType: inline.mimeType,
            data: Buffer.from(inline.data, "base64"),
          });
          break;
        }
      }
    });

    return {
      status,
      results,
      errorMessage: status === "failed" ? (op?.error?.message ?? "batch failed") : undefined,
    };
  }
}

function mapStatus(op: BatchesGetResponse | undefined): BatchStatus {
  if (!op) return "in_progress";
  if (op.done === true || op.state === "BATCH_STATE_SUCCEEDED" || op.state === "SUCCEEDED") {
    return "completed";
  }
  if (op.state === "BATCH_STATE_FAILED" || op.state === "FAILED") return "failed";
  if (op.state === "BATCH_STATE_CANCELLED" || op.state === "CANCELLED") return "cancelled";
  if (op.state === "BATCH_STATE_EXPIRED" || op.state === "EXPIRED") return "expired";
  return "in_progress";
}

interface BatchesGetResponse {
  done?: boolean;
  state?: string;
  name?: string;
  batchId?: string;
  error?: { message?: string };
  response?: { responses?: GeminiResponse[] };
  responses?: GeminiResponse[];
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

interface BatchesApi {
  create?: (req: { model: string; requests: unknown[] }) => Promise<BatchesGetResponse>;
  get?: (req: { name: string }) => Promise<BatchesGetResponse>;
}
