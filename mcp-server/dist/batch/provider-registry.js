import { requireGeminiKey, requireOpenAIKey } from "../config.js";
import { StructuredError } from "../util/errors.js";
import { GoogleImageBatchProvider } from "./google.js";
import { OpenAIImageBatchProvider } from "./openai.js";
export function createBatchProvider(providerId, modality, config) {
    if (providerId === "google" && modality === "image") {
        return new GoogleImageBatchProvider({ apiKey: requireGeminiKey(config) });
    }
    if (providerId === "openai" && modality === "image") {
        return new OpenAIImageBatchProvider({ apiKey: requireOpenAIKey(config) });
    }
    throw new StructuredError("VALIDATION_ERROR", `Batch is not yet implemented for ${providerId}/${modality} in this version. Currently implemented: google/image, openai/image.`, `Use sync mode (generate_image / generate_speech), or pick a batch-implemented combo: --provider google or --provider openai (image only).`);
}
