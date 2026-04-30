import { injectAspectIntoPrompt } from "../util/aspect.js";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export class OpenRouterProvider {
    id = "openrouter";
    apiKey;
    constructor(opts) {
        this.apiKey = opts.apiKey;
    }
    async generateImage(req) {
        const effectivePrompt = req.aspectRatio
            ? injectAspectIntoPrompt(req.prompt, req.aspectRatio)
            : req.prompt;
        const body = {
            model: req.model,
            messages: [{ role: "user", content: effectivePrompt }],
            modalities: ["image", "text"],
            ...(req.params ?? {}),
        };
        const response = await fetch(ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/sherifbutt/claude-image-tts-gen",
                "X-Title": "claude-image-tts-gen",
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenRouter ${response.status}: ${text}`);
        }
        const data = (await response.json());
        if (data.error?.message) {
            throw new Error(`OpenRouter error: ${data.error.message}`);
        }
        const message = data.choices?.[0]?.message;
        const images = message?.images ?? [];
        for (const item of images) {
            const url = item?.image_url?.url;
            if (typeof url !== "string")
                continue;
            const parsed = parseDataUrl(url);
            if (parsed) {
                return {
                    mimeType: parsed.mimeType,
                    data: parsed.data,
                    modelUsed: req.model,
                    providerUsed: this.id,
                };
            }
        }
        throw new Error(`OpenRouter returned no image for model ${req.model}. ` +
            `The model may not support image output, or the prompt was rejected.`);
    }
}
function parseDataUrl(url) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match)
        return null;
    return {
        mimeType: match[1],
        data: Buffer.from(match[2], "base64"),
    };
}
