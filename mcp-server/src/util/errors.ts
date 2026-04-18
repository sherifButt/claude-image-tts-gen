export type ErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMIT"
  | "CONTENT_POLICY"
  | "VALIDATION_ERROR"
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "BUDGET_EXCEEDED"
  | "CONFIG_ERROR"
  | "GENERATION_ERROR"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface StructuredErrorJson {
  success: false;
  errorCode: ErrorCode;
  error: string;
  suggestedFix: string;
  cause?: string;
  /** Extra machine-readable hints (e.g. availableTiers, providersForTier). */
  meta?: Record<string, unknown>;
}

export class StructuredError extends Error {
  readonly code: ErrorCode;
  readonly suggestedFix: string;
  readonly cause?: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    suggestedFix: string,
    cause?: string,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StructuredError";
    this.code = code;
    this.suggestedFix = suggestedFix;
    this.cause = cause;
    this.meta = meta;
  }

  toJSON(): StructuredErrorJson {
    return {
      success: false,
      errorCode: this.code,
      error: this.message,
      suggestedFix: this.suggestedFix,
      ...(this.cause ? { cause: this.cause } : {}),
      ...(this.meta ? { meta: this.meta } : {}),
    };
  }
}

export function isStructuredError(err: unknown): err is StructuredError {
  return err instanceof StructuredError;
}

export function asStructuredError(
  err: unknown,
  fallbackCode: ErrorCode = "UNKNOWN",
  fallbackFix = "Re-run with verbose logging or open an issue.",
): StructuredError {
  if (isStructuredError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new StructuredError(fallbackCode, message, fallbackFix);
}

export function mapProviderError(rawError: unknown, providerId: string): StructuredError {
  if (isStructuredError(rawError)) return rawError;

  const message = rawError instanceof Error ? rawError.message : String(rawError);
  const lower = message.toLowerCase();

  const status = matchHttpStatus(message);

  if (status === 401 || status === 403 || /api[_\s-]?key|unauthorized|invalid.+key/i.test(message)) {
    return new StructuredError(
      "AUTH_FAILED",
      `${providerId} authentication failed: ${message}`,
      `Verify the ${providerId.toUpperCase()}_API_KEY env var. Run health_check to test all configured keys.`,
      message,
    );
  }

  if (status === 429 || /rate.?limit|quota|too many/i.test(message)) {
    return new StructuredError(
      "RATE_LIMIT",
      `${providerId} rate limit hit: ${message}`,
      `Wait a moment, lower request rate, or switch provider with --provider.`,
      message,
    );
  }

  if (/content.?policy|safety|moderation|blocked/i.test(message)) {
    return new StructuredError(
      "CONTENT_POLICY",
      `${providerId} content policy: ${message}`,
      `Rephrase the prompt avoiding sensitive material. Some providers are stricter than others — try a different --provider.`,
      message,
    );
  }

  if (status === 404 || /not.?found|does not exist/i.test(message)) {
    return new StructuredError(
      "NOT_FOUND",
      `${providerId} resource not found: ${message}`,
      `Check the model name. Run list_providers to see implemented options.`,
      message,
    );
  }

  if (status === 400 || /invalid|bad request|validation/i.test(message)) {
    return new StructuredError(
      "VALIDATION_ERROR",
      `${providerId} rejected the request: ${message}`,
      `Review the prompt/text and any --model or --voice values.`,
      message,
    );
  }

  if (status !== null && status >= 500) {
    return new StructuredError(
      "PROVIDER_ERROR",
      `${providerId} returned ${status}: ${message}`,
      `Provider is having issues. Retry, or switch to another provider via --provider.`,
      message,
    );
  }

  if (lower.includes("etimedout") || lower.includes("timeout")) {
    return new StructuredError(
      "PROVIDER_TIMEOUT",
      `${providerId} timed out: ${message}`,
      `Retry, or pick a faster tier (e.g. --tier small).`,
      message,
    );
  }

  return new StructuredError(
    "PROVIDER_ERROR",
    `${providerId}: ${message}`,
    `Run health_check to verify provider state.`,
    message,
  );
}

function matchHttpStatus(message: string): number | null {
  const m = message.match(/\b([45]\d\d)\b/);
  return m ? Number(m[1]) : null;
}
