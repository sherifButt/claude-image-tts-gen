export function loadConfig(env = process.env) {
    const logLevel = (env.LOG_LEVEL ?? "info").toLowerCase();
    const validLog = ["error", "warn", "info", "debug"].includes(logLevel)
        ? logLevel
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
        localBaseUrl: env.LOCAL_BASE_URL ?? env.LMSTUDIO_BASE_URL ?? "http://localhost:8880/v1",
        // Tristate: explicit env wins, otherwise auto-probe at startup.
        // Back-compat: LMSTUDIO_ENABLED is still read.
        localEnabled: ["true", "1", "yes", "on"].includes((env.LOCAL_ENABLED ?? env.LMSTUDIO_ENABLED ?? "").toLowerCase()),
        localAutoProbe: env.LOCAL_ENABLED === undefined && env.LMSTUDIO_ENABLED === undefined,
        voiceboxBaseUrl: env.VOICEBOX_BASE_URL ?? "http://localhost:17493",
        voiceboxEnabled: ["true", "1", "yes", "on"].includes((env.VOICEBOX_ENABLED ?? "").toLowerCase()),
        voiceboxAutoProbe: env.VOICEBOX_ENABLED === undefined,
        geminiImageModel: env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
        imageOutputDir: env.IMAGE_OUTPUT_DIR ?? sharedDir ?? "./generated-images",
        audioOutputDir: env.AUDIO_OUTPUT_DIR ?? sharedDir ?? "./generated-audio",
        logLevel: validLog,
        autoplay: ["true", "1", "yes", "on"].includes((env.AUTOPLAY ?? "").toLowerCase()),
        // Default true per CLAUDE.md decision (opt-out via REWRITE_PROMPTS=false).
        rewritePrompts: !["false", "0", "no", "off"].includes((env.REWRITE_PROMPTS ?? "true").toLowerCase()),
        emitSidecar: !["false", "0", "no", "off"].includes((env.EMIT_SIDECAR ?? "true").toLowerCase()),
        geminiDefaultVoice: env.GEMINI_DEFAULT_VOICE?.trim() || undefined,
        openaiDefaultVoice: env.OPENAI_DEFAULT_VOICE?.trim() || undefined,
        elevenlabsDefaultVoice: env.ELEVENLABS_DEFAULT_VOICE?.trim() || undefined,
        localDefaultVoice: env.LOCAL_DEFAULT_VOICE?.trim() || undefined,
        voiceboxDefaultVoice: env.VOICEBOX_DEFAULT_VOICE?.trim() || undefined,
    };
}
function requireKey(envName, providerLabel, value) {
    if (!value) {
        // Imported lazily to avoid a circular import (errors.ts → util/output → config).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StructuredError } = require("./util/errors.js");
        throw new StructuredError("CONFIG_ERROR", `${envName} is required for the ${providerLabel} provider`, `Set ${envName}=... in your shell, or via the plugin's user_config.`);
    }
    return value;
}
export function requireGeminiKey(config) {
    return requireKey("GEMINI_API_KEY", "google", config.geminiApiKey);
}
export function requireOpenAIKey(config) {
    return requireKey("OPENAI_API_KEY", "openai", config.openaiApiKey);
}
export function requireOpenRouterKey(config) {
    return requireKey("OPENROUTER_API_KEY", "openrouter", config.openrouterApiKey);
}
export function requireElevenLabsKey(config) {
    return requireKey("ELEVENLABS_API_KEY", "elevenlabs", config.elevenlabsApiKey);
}
