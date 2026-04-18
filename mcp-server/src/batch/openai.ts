import OpenAI, { toFile } from "openai";
import type { Modality, ProviderId } from "../providers/types.js";
import type { BatchProvider } from "./provider.js";
import type {
  BatchPollResult,
  BatchPrompt,
  BatchStatus,
  BatchSubmitResult,
} from "./types.js";

interface OpenAIBatchOptions {
  apiKey: string;
}

interface BatchOutputLine {
  custom_id?: string;
  response?: {
    status_code?: number;
    body?: {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string };
    };
  };
  error?: { message?: string };
}

export class OpenAIImageBatchProvider implements BatchProvider {
  readonly id: ProviderId = "openai";
  readonly modality: Modality = "image";

  private readonly client: OpenAI;

  constructor(opts: OpenAIBatchOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
  }

  async submit(prompts: BatchPrompt[], model: string): Promise<BatchSubmitResult> {
    const lines = prompts.map((p) =>
      JSON.stringify({
        custom_id: p.customId,
        method: "POST",
        url: "/v1/images/generations",
        body: {
          model,
          prompt: p.text,
          n: 1,
          ...(p.params ?? {}),
        },
      }),
    );
    const jsonl = lines.join("\n") + "\n";

    const file = await this.client.files.create({
      file: await toFile(Buffer.from(jsonl, "utf8"), "batch.jsonl"),
      purpose: "batch",
    });

    const batch = await this.client.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/images/generations",
      completion_window: "24h",
      metadata: { source: "claude-image-tts-gen" },
    });

    return { providerJobId: batch.id };
  }

  async poll(providerJobId: string): Promise<BatchPollResult> {
    const batch = await this.client.batches.retrieve(providerJobId);
    const status = mapStatus(batch.status);

    if (status !== "completed" && status !== "partial_failure" && status !== "failed") {
      return { status };
    }

    if (!batch.output_file_id) {
      return {
        status: "failed",
        errorMessage: `Batch ${providerJobId} reports ${batch.status} but has no output_file_id`,
      };
    }

    const fileResponse = await this.client.files.content(batch.output_file_id);
    const outputText = await fileResponse.text();

    const results: BatchPollResult["results"] = [];
    let firstError: string | undefined;

    for (const rawLine of outputText.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const item = JSON.parse(line) as BatchOutputLine;
        const customId = item.custom_id;
        if (!customId) continue;

        const errMsg = item.error?.message ?? item.response?.body?.error?.message;
        if (errMsg) {
          if (!firstError) firstError = errMsg;
          continue;
        }

        const b64 = item.response?.body?.data?.[0]?.b64_json;
        if (b64) {
          results.push({
            customId,
            mimeType: "image/png",
            data: Buffer.from(b64, "base64"),
          });
        }
      } catch {
        // skip malformed line
      }
    }

    const finalStatus: BatchStatus =
      status === "completed" && firstError && results.length === 0
        ? "failed"
        : status === "completed" && firstError
          ? "partial_failure"
          : status;

    return {
      status: finalStatus,
      results,
      errorMessage: firstError,
    };
  }
}

function mapStatus(s: string): BatchStatus {
  switch (s) {
    case "completed":
      return "completed";
    case "in_progress":
    case "validating":
    case "finalizing":
      return "in_progress";
    case "failed":
      return "failed";
    case "cancelling":
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "in_progress";
  }
}
