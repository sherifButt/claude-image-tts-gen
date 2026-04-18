export interface Config {
  geminiApiKey: string | undefined;
  openaiApiKey: string | undefined;
  openrouterApiKey: string | undefined;
  elevenlabsApiKey: string | undefined;
  geminiImageModel: string;
  imageOutputDir: string;
  audioOutputDir: string;
  logLevel: "error" | "warn" | "info" | "debug";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const logLevel = (env.LOG_LEVEL ?? "info").toLowerCase();
  const validLog = ["error", "warn", "info", "debug"].includes(logLevel)
    ? (logLevel as Config["logLevel"])
    : "info";

  const sharedDir = env.OUTPUT_DIR;

  return {
    geminiApiKey: env.GEMINI_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    elevenlabsApiKey: env.ELEVENLABS_API_KEY,
    geminiImageModel: env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
    imageOutputDir: env.IMAGE_OUTPUT_DIR ?? sharedDir ?? "./generated-images",
    audioOutputDir: env.AUDIO_OUTPUT_DIR ?? sharedDir ?? "./generated-audio",
    logLevel: validLog,
  };
}

export function requireGeminiKey(config: Config): string {
  if (!config.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is required for the google provider. Set it in your environment or plugin config.",
    );
  }
  return config.geminiApiKey;
}

export function requireOpenAIKey(config: Config): string {
  if (!config.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for the openai provider. Set it in your environment or plugin config.",
    );
  }
  return config.openaiApiKey;
}

export function requireOpenRouterKey(config: Config): string {
  if (!config.openrouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is required for the openrouter provider. Set it in your environment or plugin config.",
    );
  }
  return config.openrouterApiKey;
}

export function requireElevenLabsKey(config: Config): string {
  if (!config.elevenlabsApiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is required for the elevenlabs provider. Set it in your environment or plugin config.",
    );
  }
  return config.elevenlabsApiKey;
}
