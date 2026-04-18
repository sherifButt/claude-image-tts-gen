export interface Config {
  geminiApiKey: string | undefined;
  openaiApiKey: string | undefined;
  openrouterApiKey: string | undefined;
  elevenlabsApiKey: string | undefined;
  /** Local LM Studio OpenAI-compatible base URL (default http://localhost:1234/v1). */
  lmstudioBaseUrl: string;
  /** Whether LM Studio is configured (always true since default localhost; controls failover inclusion). */
  lmstudioEnabled: boolean;
  geminiImageModel: string;
  imageOutputDir: string;
  audioOutputDir: string;
  logLevel: "error" | "warn" | "info" | "debug";
  autoplay: boolean;
  rewritePrompts: boolean;
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
    lmstudioBaseUrl: env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    // Opt-in via LMSTUDIO_ENABLED=true; off by default since localhost may not be running.
    lmstudioEnabled: ["true", "1", "yes", "on"].includes(
      (env.LMSTUDIO_ENABLED ?? "").toLowerCase(),
    ),
    geminiImageModel: env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
    imageOutputDir: env.IMAGE_OUTPUT_DIR ?? sharedDir ?? "./generated-images",
    audioOutputDir: env.AUDIO_OUTPUT_DIR ?? sharedDir ?? "./generated-audio",
    logLevel: validLog,
    autoplay: ["true", "1", "yes", "on"].includes((env.AUTOPLAY ?? "").toLowerCase()),
    // Default true per CLAUDE.md decision (opt-out via REWRITE_PROMPTS=false).
    rewritePrompts: !["false", "0", "no", "off"].includes(
      (env.REWRITE_PROMPTS ?? "true").toLowerCase(),
    ),
  };
}

function requireKey(envName: string, providerLabel: string, value: string | undefined): string {
  if (!value) {
    // Imported lazily to avoid a circular import (errors.ts → util/output → config).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { StructuredError } = require("./util/errors.js") as typeof import("./util/errors.js");
    throw new StructuredError(
      "CONFIG_ERROR",
      `${envName} is required for the ${providerLabel} provider`,
      `Set ${envName}=... in your shell, or via the plugin's user_config.`,
    );
  }
  return value;
}

export function requireGeminiKey(config: Config): string {
  return requireKey("GEMINI_API_KEY", "google", config.geminiApiKey);
}

export function requireOpenAIKey(config: Config): string {
  return requireKey("OPENAI_API_KEY", "openai", config.openaiApiKey);
}

export function requireOpenRouterKey(config: Config): string {
  return requireKey("OPENROUTER_API_KEY", "openrouter", config.openrouterApiKey);
}

export function requireElevenLabsKey(config: Config): string {
  return requireKey("ELEVENLABS_API_KEY", "elevenlabs", config.elevenlabsApiKey);
}
