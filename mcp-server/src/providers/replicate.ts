import type {
  AvatarGenRequest,
  AvatarGenResult,
  AvatarProvider,
  ProviderId,
  VideoGenRequest,
  VideoGenResult,
  VideoProvider,
} from "./types.js";

const API_BASE = "https://api.replicate.com/v1";
/** Poll cadence + ceiling for the prediction lifecycle. Video gen is slow
 *  (tens of seconds to a few minutes), so poll gently but wait generously. */
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

interface Prediction {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  urls?: { get?: string; cancel?: string };
}

/**
 * Replicate provider — video via xAI grok-imagine-video-1.5 (image-to-video,
 * motion) and talking-avatar video via VEED Fabric 1.0 (image + audio →
 * lip-synced video). Uses the model-scoped predictions endpoint: create a
 * prediction, poll its `urls.get` until terminal, then download the output.
 */
export class ReplicateProvider implements VideoProvider, AvatarProvider {
  readonly id: ProviderId = "replicate";

  private readonly apiToken: string;

  constructor(opts: { apiToken: string }) {
    this.apiToken = opts.apiToken;
  }

  async generateVideo(req: VideoGenRequest): Promise<VideoGenResult> {
    const input: Record<string, unknown> = {
      // Omitted entirely on a text-to-video run — p-video treats a missing
      // `image` as "generate from the prompt", and sending null would 422.
      ...(req.image ? { image: toDataUri(req.image.mimeType, req.image.data) } : {}),
      prompt: req.prompt,
      duration: req.durationSeconds,
      ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
      // Slot params (resolution) and any caller overrides win last.
      ...(req.params ?? {}),
    };
    const { data, mimeType } = await this.runToOutput(req.model, input);
    return {
      mimeType,
      data,
      modelUsed: req.model,
      providerUsed: this.id,
      durationSeconds: req.durationSeconds,
    };
  }

  async generateAvatar(req: AvatarGenRequest): Promise<AvatarGenResult> {
    const input: Record<string, unknown> = {
      image: toDataUri(req.image.mimeType, req.image.data),
      audio: toDataUri(req.audio.mimeType, req.audio.data),
      // p-video requires a motion prompt; Fabric takes none and is given none.
      ...(req.prompt ? { prompt: req.prompt } : {}),
      // Slot params (resolution, fps, draft, ...) and caller overrides win last.
      ...(req.params ?? {}),
    };
    const { data, mimeType } = await this.runToOutput(req.model, input);
    return {
      mimeType,
      data,
      modelUsed: req.model,
      providerUsed: this.id,
      durationSeconds: req.durationSeconds,
    };
  }

  /** Create a prediction, poll to terminal, download the output file. */
  private async runToOutput(
    model: string,
    input: Record<string, unknown>,
  ): Promise<{ data: Buffer; mimeType: string }> {
    const created = await this.createPrediction(model, input);
    const settled = await this.pollUntilDone(created);

    if (settled.status !== "succeeded") {
      const detail = settled.error ? `: ${settled.error}` : "";
      throw new Error(
        `Replicate prediction ${settled.status ?? "unknown"} for ${model}${detail}`,
      );
    }

    const url = firstOutputUrl(settled.output);
    if (!url) {
      throw new Error(
        `Replicate ${model} returned no output URL (output: ${JSON.stringify(settled.output)?.slice(0, 200)}).`,
      );
    }
    return await downloadBinary(url);
  }

  private async createPrediction(
    model: string,
    input: Record<string, unknown>,
  ): Promise<Prediction> {
    const res = await this.fetchJson(`${API_BASE}/models/${model}/predictions`, {
      method: "POST",
      body: JSON.stringify({ input }),
    });
    return res;
  }

  private async pollUntilDone(prediction: Prediction): Promise<Prediction> {
    const pollUrl = prediction.urls?.get ?? `${API_BASE}/predictions/${prediction.id}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let current = prediction;

    while (!isTerminal(current.status)) {
      if (Date.now() > deadline) {
        throw new Error(
          `Replicate prediction ${current.id ?? "?"} timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s (last status: ${current.status ?? "unknown"}).`,
        );
      }
      await sleep(POLL_INTERVAL_MS);
      current = await this.fetchJson(pollUrl, { method: "GET" });
    }
    return current;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Prediction> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Replicate ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as Prediction;
    } finally {
      clearTimeout(t);
    }
  }
}

function toDataUri(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

function isTerminal(status: Prediction["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

/** Grok video output is typically a single URL string; tolerate array form too. */
function firstOutputUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output.find((o) => typeof o === "string");
    return typeof first === "string" ? first : null;
  }
  return null;
}

async function downloadBinary(url: string): Promise<{ data: Buffer; mimeType: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`Failed to download Replicate output (${res.status}) from ${url}`);
    }
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
    const buf = Buffer.from(await res.arrayBuffer());
    return { data: buf, mimeType };
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
