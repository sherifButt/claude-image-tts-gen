import type { Config } from "../config.js";
import { listLocalModels, type LocalModel } from "../providers/local.js";
import { StructuredError } from "../util/errors.js";

export interface CheckLocalOutput {
  success: true;
  baseUrl: string;
  modelCount: number;
  models: LocalModel[];
  hints: {
    hasTtsModel: boolean;
    hasImageModel: boolean;
    probableBackend:
      | "kokoro-fastapi"
      | "speaches"
      | "orpheus-fastapi"
      | "chatterbox"
      | "lm-studio"
      | "unknown";
  };
  text: string;
}

export async function checkLocal(config: Config): Promise<CheckLocalOutput> {
  let models: LocalModel[];
  try {
    models = await listLocalModels(config.localBaseUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StructuredError(
      "PROVIDER_ERROR",
      `Could not reach local server at ${config.localBaseUrl}: ${message}`,
      `Start an OpenAI-compatible server (Kokoro-FastAPI, Speaches, Orpheus-FastAPI, LM Studio, ...) or set LOCAL_BASE_URL to its base URL. Example:
  docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
  export LOCAL_BASE_URL=http://localhost:8880/v1`,
    );
  }

  const hasTtsModel = models.some((m) => m.likelyCapability === "tts");
  const hasImageModel = models.some((m) => m.likelyCapability === "image");
  const probableBackend = guessBackend(config.localBaseUrl, models);

  const lines = models.map(
    (m) => `  ${m.id}  [${m.likelyCapability}]`,
  );
  const header = `Local server at ${config.localBaseUrl} — ${models.length} model(s) loaded`;
  const backendLine = `Probable backend: ${probableBackend}`;
  const capLines = [
    hasTtsModel ? "✅ TTS model detected" : "⚠️  No TTS model in /v1/models",
    hasImageModel ? "✅ image model detected" : "⚠️  No image model in /v1/models",
  ];
  const note =
    probableBackend === "lm-studio"
      ? `\nNote: LM Studio's OpenAI-compatible server does NOT expose /v1/audio/speech or /v1/images/generations — loading an Orpheus or Stable Diffusion model will not make TTS or image generation work through this provider. Use Kokoro-FastAPI or similar instead.`
      : "";
  const text = [header, backendLine, ...capLines, ...lines].join("\n") + note;

  return {
    success: true,
    baseUrl: config.localBaseUrl,
    modelCount: models.length,
    models,
    hints: { hasTtsModel, hasImageModel, probableBackend },
    text,
  };
}

function guessBackend(
  baseUrl: string,
  models: LocalModel[],
): CheckLocalOutput["hints"]["probableBackend"] {
  const ids = models.map((m) => m.id.toLowerCase()).join(" ");
  if (/kokoro/.test(ids) || /:8880/.test(baseUrl)) return "kokoro-fastapi";
  if (/orpheus/.test(ids) && /:5005/.test(baseUrl)) return "orpheus-fastapi";
  if (/chatterbox/.test(ids)) return "chatterbox";
  if (/speaches|piper/.test(ids) || /:8000/.test(baseUrl)) return "speaches";
  if (/:1234/.test(baseUrl)) return "lm-studio";
  return "unknown";
}
