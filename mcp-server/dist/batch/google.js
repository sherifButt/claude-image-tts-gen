import { GoogleGenAI } from "@google/genai";
export class GoogleImageBatchProvider {
    id = "google";
    modality = "image";
    client;
    constructor(opts) {
        this.client = new GoogleGenAI({ apiKey: opts.apiKey });
    }
    async submit(prompts, model) {
        const inlinedRequests = prompts.map((p) => ({
            contents: [{ parts: [{ text: p.text }] }],
        }));
        const batches = this.client.batches;
        if (!batches?.create) {
            throw new Error("@google/genai SDK does not expose batches.create — upgrade the SDK or implement REST fallback");
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
    async poll(providerJobId) {
        const batches = this.client.batches;
        if (!batches?.get) {
            throw new Error("@google/genai SDK does not expose batches.get — upgrade the SDK or implement REST fallback");
        }
        const op = await batches.get({ name: providerJobId });
        const status = mapStatus(op);
        if (status !== "completed" && status !== "partial_failure" && status !== "failed") {
            return { status };
        }
        const inlined = op?.dest?.inlinedResponses ?? [];
        const results = [];
        let firstError;
        inlined.forEach((entry, idx) => {
            if (entry?.error?.message) {
                if (!firstError)
                    firstError = entry.error.message;
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
        const finalStatus = status === "completed" && firstError && results.length === 0
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
function mapStatus(op) {
    if (!op)
        return "in_progress";
    const state = op.state;
    if (state === "JOB_STATE_SUCCEEDED")
        return "completed";
    if (state === "JOB_STATE_FAILED")
        return "failed";
    if (state === "JOB_STATE_CANCELLED")
        return "cancelled";
    if (state === "JOB_STATE_EXPIRED")
        return "expired";
    return "in_progress";
}
