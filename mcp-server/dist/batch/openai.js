import OpenAI, { toFile } from "openai";
export class OpenAIImageBatchProvider {
    id = "openai";
    modality = "image";
    client;
    constructor(opts) {
        this.client = new OpenAI({ apiKey: opts.apiKey });
    }
    async submit(prompts, model) {
        const lines = prompts.map((p) => JSON.stringify({
            custom_id: p.customId,
            method: "POST",
            url: "/v1/images/generations",
            body: {
                model,
                prompt: p.text,
                n: 1,
                ...(p.params ?? {}),
            },
        }));
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
    async poll(providerJobId) {
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
        const results = [];
        let firstError;
        for (const rawLine of outputText.split("\n")) {
            const line = rawLine.trim();
            if (!line)
                continue;
            try {
                const item = JSON.parse(line);
                const customId = item.custom_id;
                if (!customId)
                    continue;
                const errMsg = item.error?.message ?? item.response?.body?.error?.message;
                if (errMsg) {
                    if (!firstError)
                        firstError = errMsg;
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
            }
            catch {
                // skip malformed line
            }
        }
        const finalStatus = status === "completed" && firstError && results.length === 0
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
function mapStatus(s) {
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
