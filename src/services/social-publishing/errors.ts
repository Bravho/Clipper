/**
 * Errors from the social publishing layer.
 *
 * The single most important thing here is the RETRYABLE/PERMANENT split. Jobs
 * retry with backoff, and retrying a permanent error is worse than useless: it
 * burns rate limit, delays the user's real answer, and can look like spam to the
 * platform. "Account disconnected" will never succeed on the fifth attempt.
 *
 * Raw provider payloads never escape this layer. Callers get a stable `code`
 * they can map to a localised message.
 */

export type SocialErrorCode =
  // ── Retryable ────────────────────────────────────────────────────────────
  | "network"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "media_processing"
  // ── Permanent ────────────────────────────────────────────────────────────
  | "not_configured"
  | "unauthorized"
  | "permission_denied"
  | "account_disconnected"
  | "invalid_account"
  | "unsupported_media"
  | "invalid_metadata"
  | "validation_failed"
  | "not_found"
  | "duplicate"
  | "unknown";

const RETRYABLE: ReadonlySet<SocialErrorCode> = new Set([
  "network",
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "media_processing",
]);

export class SocialPublishingError extends Error {
  readonly code: SocialErrorCode;
  readonly retryable: boolean;
  /** HTTP status, when the failure came from an HTTP response. */
  readonly status?: number;

  constructor(
    code: SocialErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message);
    this.name = "SocialPublishingError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.status = options?.status;
    if (options?.cause) this.cause = options.cause;
  }

  /** True when a bounded retry with backoff is worth attempting. */
  static isRetryable(err: unknown): boolean {
    return err instanceof SocialPublishingError && err.retryable;
  }
}

/**
 * Map an HTTP status to an error code.
 *
 * 401/403 are permanent on purpose: a bad or revoked API key does not fix
 * itself, and hammering the provider with it risks the whole project's access.
 * 409 is treated as a duplicate rather than a conflict to retry — the usual
 * cause is a post we already created.
 */
export function codeForHttpStatus(status: number): SocialErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "duplicate";
  if (status === 422) return "validation_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "unknown";
}

/**
 * Classify a per-destination failure from the provider's free-text error.
 *
 * The provider normalises platform errors only loosely, so this inspects the
 * text. It is intentionally conservative: anything unrecognised is classified
 * "unknown", which is treated as PERMANENT. Retrying something we do not
 * understand is the more dangerous default — it can repost, or spam a platform.
 */
export function classifyTargetError(raw: unknown): {
  code: SocialErrorCode;
  message: string;
} {
  const text = extractMessage(raw);
  const lower = text.toLowerCase();

  const has = (...needles: string[]) => needles.some((n) => lower.includes(n));

  if (has("still processing", "media is processing", "not ready", "try again later")) {
    return { code: "media_processing", message: text };
  }
  if (has("rate limit", "too many requests", "throttl")) {
    return { code: "rate_limited", message: text };
  }
  if (has("timeout", "timed out", "econnreset", "socket hang up")) {
    return { code: "timeout", message: text };
  }
  if (has("temporarily unavailable", "server error", "internal error", "503", "502")) {
    return { code: "provider_unavailable", message: text };
  }
  if (has("disconnect", "reconnect", "token expired", "re-authenticate", "reauth")) {
    return { code: "account_disconnected", message: text };
  }
  if (has("permission", "not authorized", "unauthorized", "scope", "forbidden")) {
    return { code: "permission_denied", message: text };
  }
  if (has("unsupported", "invalid format", "codec", "aspect ratio", "too long", "too large")) {
    return { code: "unsupported_media", message: text };
  }
  if (has("invalid account", "account not found", "no such account")) {
    return { code: "invalid_account", message: text };
  }
  if (has("caption", "title", "hashtag", "invalid parameter", "validation")) {
    return { code: "invalid_metadata", message: text };
  }
  if (has("duplicate", "already posted", "already published")) {
    return { code: "duplicate", message: text };
  }

  return { code: "unknown", message: text };
}

/** Pull a human-readable string out of whatever the provider returned. */
function extractMessage(raw: unknown): string {
  if (!raw) return "The platform rejected this post.";
  if (typeof raw === "string") return truncate(raw);
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "description", "reason"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return truncate(value);
    }
    try {
      return truncate(JSON.stringify(raw));
    } catch {
      return "The platform rejected this post.";
    }
  }
  return truncate(String(raw));
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
