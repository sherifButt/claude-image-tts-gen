const API_BASE = "https://api.replicate.com/v1";
/** Poll cadence + ceiling for the prediction lifecycle. Video gen is slow
 *  (tens of seconds to a few minutes), so poll gently but wait generously. */
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Replicate provider — currently video-only via xAI grok-imagine-video-1.5.
 * Uses the model-scoped predictions endpoint: create a prediction, then poll
 * its `urls.get` until it reaches a terminal state, then download the output.
 */
export class ReplicateProvider {
    id = "replicate";
    apiToken;
    constructor(opts) {
        this.apiToken = opts.apiToken;
    }
    async generateVideo(req) {
        const input = {
            image: toDataUri(req.image.mimeType, req.image.data),
            prompt: req.prompt,
            duration: req.durationSeconds,
            ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
            // Slot params (resolution) and any caller overrides win last.
            ...(req.params ?? {}),
        };
        const created = await this.createPrediction(req.model, input);
        const settled = await this.pollUntilDone(created);
        if (settled.status !== "succeeded") {
            const detail = settled.error ? `: ${settled.error}` : "";
            throw new Error(`Replicate prediction ${settled.status ?? "unknown"} for ${req.model}${detail}`);
        }
        const url = firstOutputUrl(settled.output);
        if (!url) {
            throw new Error(`Replicate ${req.model} returned no video URL (output: ${JSON.stringify(settled.output)?.slice(0, 200)}).`);
        }
        const { data, mimeType } = await downloadBinary(url);
        return {
            mimeType,
            data,
            modelUsed: req.model,
            providerUsed: this.id,
            durationSeconds: req.durationSeconds,
        };
    }
    async createPrediction(model, input) {
        const res = await this.fetchJson(`${API_BASE}/models/${model}/predictions`, {
            method: "POST",
            body: JSON.stringify({ input }),
        });
        return res;
    }
    async pollUntilDone(prediction) {
        const pollUrl = prediction.urls?.get ?? `${API_BASE}/predictions/${prediction.id}`;
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let current = prediction;
        while (!isTerminal(current.status)) {
            if (Date.now() > deadline) {
                throw new Error(`Replicate prediction ${current.id ?? "?"} timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s (last status: ${current.status ?? "unknown"}).`);
            }
            await sleep(POLL_INTERVAL_MS);
            current = await this.fetchJson(pollUrl, { method: "GET" });
        }
        return current;
    }
    async fetchJson(url, init) {
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
            return (await res.json());
        }
        finally {
            clearTimeout(t);
        }
    }
}
function toDataUri(mimeType, data) {
    return `data:${mimeType};base64,${data.toString("base64")}`;
}
function isTerminal(status) {
    return status === "succeeded" || status === "failed" || status === "canceled";
}
/** Grok video output is typically a single URL string; tolerate array form too. */
function firstOutputUrl(output) {
    if (typeof output === "string")
        return output;
    if (Array.isArray(output)) {
        const first = output.find((o) => typeof o === "string");
        return typeof first === "string" ? first : null;
    }
    return null;
}
async function downloadBinary(url) {
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
    }
    finally {
        clearTimeout(t);
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
