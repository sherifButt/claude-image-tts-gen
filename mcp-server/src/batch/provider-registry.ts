import type { Config } from "../config.js";
import { requireGeminiKey } from "../config.js";
import type { Modality, ProviderId } from "../providers/types.js";
import { StructuredError } from "../util/errors.js";
import { GoogleImageBatchProvider } from "./google.js";
import type { BatchProvider } from "./provider.js";

export function createBatchProvider(
  providerId: ProviderId,
  modality: Modality,
  config: Config,
): BatchProvider {
  if (providerId === "google" && modality === "image") {
    return new GoogleImageBatchProvider({ apiKey: requireGeminiKey(config) });
  }
  throw new StructuredError(
    "VALIDATION_ERROR",
    `Batch is not yet implemented for ${providerId}/${modality} in this version. Currently implemented: google/image.`,
    `Use sync mode (generate_image / generate_speech), or switch to --provider google for batch.`,
  );
}
