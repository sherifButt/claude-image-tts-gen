import OpenAI, { toFile } from "openai";
import { aspectToOpenAISize } from "../util/aspect.js";
const DEFAULT_VOICE = "alloy";
const DEFAULT_AUDIO_FORMAT = "mp3";
export class OpenAIProvider {
    id = "openai";
    client;
    constructor(opts) {
        this.client = new OpenAI({ apiKey: opts.apiKey });
    }
    async generateImage(req) {
        const params = req.params ?? {};
        const quality = params.quality ?? "auto";
        const size = req.aspectRatio
            ? aspectToOpenAISize(req.aspectRatio)
            : (params.size ?? "auto");
        let item;
        if (req.referenceImage) {
            const ext = (req.referenceImage.mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "");
            const filename = `reference.${ext === "jpeg" ? "png" : ext}`;
            const file = await toFile(req.referenceImage.data, filename, {
                type: req.referenceImage.mimeType,
            });
            const response = await this.client.images.edit({
                model: req.model,
                image: file,
                prompt: req.prompt,
                n: 1,
                size,
                quality,
            });
            item = response.data?.[0];
        }
        else {
            const response = await this.client.images.generate({
                model: req.model,
                prompt: req.prompt,
                quality,
                size,
                n: 1,
            });
            item = response.data?.[0];
        }
        if (!item?.b64_json) {
            throw new Error("OpenAI image API returned no b64_json data");
        }
        return {
            mimeType: "image/png",
            data: Buffer.from(item.b64_json, "base64"),
            modelUsed: req.model,
            providerUsed: this.id,
        };
    }
    async generateSpeech(req) {
        const params = req.params ?? {};
        const format = params.format ?? DEFAULT_AUDIO_FORMAT;
        const voice = req.voice ?? DEFAULT_VOICE;
        const response = await this.client.audio.speech.create({
            model: req.model,
            input: req.text,
            voice,
            response_format: format,
        });
        const buf = Buffer.from(await response.arrayBuffer());
        const mimeType = audioFormatToMime(format);
        return {
            mimeType,
            data: buf,
            modelUsed: req.model,
            providerUsed: this.id,
        };
    }
}
function audioFormatToMime(format) {
    switch (format) {
        case "mp3":
            return "audio/mpeg";
        case "opus":
            return "audio/ogg";
        case "aac":
            return "audio/aac";
        case "flac":
            return "audio/flac";
        case "wav":
            return "audio/wav";
        case "pcm":
            return "audio/L16";
    }
}
