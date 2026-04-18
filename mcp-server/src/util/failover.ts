import type { Config } from "../config.js";
import { resolveSlot, type ResolvedSlot } from "../providers/registry.js";
import type { Modality, ProviderId, Tier } from "../providers/types.js";
import { isStructuredError, mapProviderError, StructuredError } from "./errors.js";

const DEFAULT_ORDER: Record<Modality, ProviderId[]> = {
  image: ["google", "openai", "openrouter"],
  tts: ["openai", "google", "elevenlabs"],
};

const RETRYABLE_CODES = new Set(["RATE_LIMIT", "PROVIDER_ERROR", "PROVIDER_TIMEOUT"]);

function hasKeyFor(providerId: ProviderId, config: Config): boolean {
  switch (providerId) {
    case "google":
      return Boolean(config.geminiApiKey);
    case "openai":
      return Boolean(config.openaiApiKey);
    case "openrouter":
      return Boolean(config.openrouterApiKey);
    case "elevenlabs":
      return Boolean(config.elevenlabsApiKey);
    case "local":
      // No API key required (local server). Opt-in via LOCAL_ENABLED to include in failover.
      return config.localEnabled;
  }
}

export function getFailoverOrder(
  modality: Modality,
  preferred: ProviderId,
  config: Config,
): ProviderId[] {
  const base = DEFAULT_ORDER[modality];
  const ordered = [preferred, ...base.filter((p) => p !== preferred)];
  // Drop keyless providers EXCEPT the preferred one — we want the preferred
  // to surface a clear CONFIG_ERROR rather than silently swap to a different
  // provider (which would look like "--provider is being ignored" to callers).
  return ordered.filter((p, i) => i === 0 || hasKeyFor(p, config));
}

export function envVarNameFor(providerId: ProviderId): string {
  switch (providerId) {
    case "google":
      return "GEMINI_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "elevenlabs":
      return "ELEVENLABS_API_KEY";
    case "local":
      return "LOCAL_ENABLED (opt-in) / LOCAL_BASE_URL";
  }
}

export function isRetryable(err: unknown): boolean {
  if (!isStructuredError(err)) return false;
  return RETRYABLE_CODES.has(err.code);
}

export interface FailoverInfo {
  attemptCount: number;
  originalProvider: ProviderId;
  originalModel: string;
  originalError: string;
  fallbackProvider: ProviderId;
  fallbackModel: string;
}

export interface WithFailoverOpts<TResult> {
  modality: Modality;
  tier: Tier;
  preferredProvider: ProviderId;
  config: Config;
  /** Called per attempt with the resolved slot for that provider. */
  callProvider: (slot: ResolvedSlot, providerId: ProviderId) => Promise<TResult>;
}

export interface WithFailoverResult<TResult> {
  result: TResult;
  slot: ResolvedSlot;
  providerUsed: ProviderId;
  failover: FailoverInfo | null;
}

export async function withFailover<TResult>(
  opts: WithFailoverOpts<TResult>,
): Promise<WithFailoverResult<TResult>> {
  const order = getFailoverOrder(opts.modality, opts.preferredProvider, opts.config);

  if (order.length === 0) {
    throw new StructuredError(
      "CONFIG_ERROR",
      `No provider with a configured API key for ${opts.modality}`,
      `Set at least one of GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, ELEVENLABS_API_KEY.`,
    );
  }

  // The preferred provider sits at order[0] regardless of whether it has a
  // key (see getFailoverOrder). If it lacks one, bail with a clear error
  // rather than silently calling a different provider.
  if (!hasKeyFor(opts.preferredProvider, opts.config)) {
    throw new StructuredError(
      "CONFIG_ERROR",
      `${opts.preferredProvider} is not configured — ${envVarNameFor(opts.preferredProvider)} is not set`,
      `Set ${envVarNameFor(opts.preferredProvider)}, or omit --provider to let the default provider handle it.`,
      undefined,
      {
        requestedProvider: opts.preferredProvider,
        availableProviders: (["google", "openai", "openrouter", "elevenlabs", "local"] as ProviderId[])
          .filter((p) => hasKeyFor(p, opts.config)),
      },
    );
  }

  let originalProvider: ProviderId | null = null;
  let originalModel: string | null = null;
  let lastError: StructuredError | null = null;
  let attemptCount = 0;

  for (let i = 0; i < order.length; i++) {
    const providerId = order[i];

    let slot: ResolvedSlot;
    try {
      slot = resolveSlot({ provider: providerId, modality: opts.modality, tier: opts.tier });
    } catch {
      // Tier not implemented on this provider — skip silently in failover chain.
      // But if it's the preferred provider on first attempt, surface the error.
      if (i === 0) {
        throw new StructuredError(
          "VALIDATION_ERROR",
          `${providerId} does not offer ${opts.modality} at ${opts.tier} tier in this version`,
          `Try a different --tier, or omit --provider to let failover pick.`,
        );
      }
      continue;
    }

    if (i === 0) {
      originalProvider = providerId;
      originalModel = slot.model;
    }

    attemptCount += 1;
    try {
      const result = await opts.callProvider(slot, providerId);
      return {
        result,
        slot,
        providerUsed: providerId,
        failover:
          i === 0
            ? null
            : {
                attemptCount,
                originalProvider: originalProvider ?? providerId,
                originalModel: originalModel ?? slot.model,
                originalError: lastError?.message ?? "(unknown)",
                fallbackProvider: providerId,
                fallbackModel: slot.model,
              },
      };
    } catch (err) {
      const mapped = isStructuredError(err) ? err : mapProviderError(err, providerId);
      lastError = mapped;
      if (!isRetryable(mapped) || i === order.length - 1) {
        throw mapped;
      }
      // continue to next provider in order
    }
  }

  throw lastError ?? new StructuredError("UNKNOWN", "failover exhausted with no error", "Run health_check.");
}

export interface FailoverDetails {
  originalProvider: ProviderId;
  originalModel: string;
  originalError: string;
  fallbackProvider: ProviderId;
  fallbackModel: string;
  costDelta: number;
  currency: string;
}
