export interface Config {
  geminiApiKey: string | undefined;
  openaiApiKey: string | undefined;
  openrouterApiKey: string | undefined;
  elevenlabsApiKey: string | undefined;
  /** Local OpenAI-compatible server base URL (Kokoro-FastAPI, Speaches, Orpheus-FastAPI, LM Studio, ...). */
  localBaseUrl: string;
  /** Whether the local provider is opted in to the failover chain. */
  localEnabled: boolean;
  /** Voicebox server base URL (default http://localhost:17493 — voicebox.sh). */
  voiceboxBaseUrl: string;
  /** Whether Voicebox is opted in to the TTS failover chain. */
  voiceboxEnabled: boolean;
  geminiImageModel: string;
  imageOutputDir: string;
  audioOutputDir: string;
  logLevel: "error" | "warn" | "info" | "debug";
  autoplay: boolean;
  rewritePrompts: boolean;
  /** Write .regenerate.json sidecars next to outputs. Default true. */
  emitSidecar: boolean;
  /** Per-provider preferred default TTS voices. Each wins over the slot's
   *  default voice when the caller passes no explicit `voice` / `voicePreset`,
   *  but only when the name is valid for the resolved slot (otherwise we fall
   *  through to slot.defaultVoice silently — prevents a Gemini voice name
   *  from being sent to ElevenLabs and erroring). */
  geminiDefaultVoice: string | undefined;
  openaiDefaultVoice: string | undefined;
  elevenlabsDefaultVoice: string | undefined;
  localDefaultVoice: string | undefined;
  /** Voicebox profile_id to use when no --voice is passed. */
  voiceboxDefaultVoice: string | undefined;
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
    // Default http://localhost:8880/v1 (Kokoro-FastAPI's default port) since
    // that's the recommended local backend. Users running Orpheus-FastAPI
    // (:5005), Speaches (:8000), LM Studio (:1234), etc. can override with
    // LOCAL_BASE_URL. Back-compat: LMSTUDIO_BASE_URL is still read.
    localBaseUrl:
      env.LOCAL_BASE_URL ?? env.LMSTUDIO_BASE_URL ?? "http://localhost:8880/v1",
    // Opt-in via LOCAL_ENABLED=true; off by default since localhost may not
    // be running. Back-compat: LMSTUDIO_ENABLED is still read.
    localEnabled: ["true", "1", "yes", "on"].includes(
      (env.LOCAL_ENABLED ?? env.LMSTUDIO_ENABLED ?? "").toLowerCase(),
    ),
    voiceboxBaseUrl: env.VOICEBOX_BASE_URL ?? "http://localhost:17493",
    voiceboxEnabled: ["true", "1", "yes", "on"].includes(
      (env.VOICEBOX_ENABLED ?? "").toLowerCase(),
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
    emitSidecar: !["false", "0", "no", "off"].includes(
      (env.EMIT_SIDECAR ?? "true").toLowerCase(),
    ),
    geminiDefaultVoice: env.GEMINI_DEFAULT_VOICE?.trim() || undefined,
    openaiDefaultVoice: env.OPENAI_DEFAULT_VOICE?.trim() || undefined,
    elevenlabsDefaultVoice: env.ELEVENLABS_DEFAULT_VOICE?.trim() || undefined,
    localDefaultVoice: env.LOCAL_DEFAULT_VOICE?.trim() || undefined,
    voiceboxDefaultVoice: env.VOICEBOX_DEFAULT_VOICE?.trim() || undefined,
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
