/**
 * HTTP client for the Post for Me API.
 *
 * Verified against the live API and its OpenAPI-generated SDK:
 *   base URL  https://api.postforme.dev
 *   auth      Authorization: Bearer <POST_FOR_ME_API_KEY>
 *   endpoints all under /v1
 *
 * THE API KEY IS PROJECT-WIDE. It grants full control over every connected
 * account and post in the project, so it is server-only, never logged, and
 * never returned in a response. `redact()` below is not decoration — it is the
 * thing standing between an error log and a leaked credential.
 *
 * Retries are bounded and only for genuinely transient failures. See
 * `../errors.ts` for why retrying an unrecognised error is the dangerous
 * default.
 */

import { POST_FOR_ME_CONFIG, requirePostForMeApiKey } from "@/config/management";
import { SocialPublishingError, codeForHttpStatus } from "../errors";

/** Header and body keys whose values must never reach a log. */
const SECRET_KEYS = [
  "authorization",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "password",
  "post-for-me-webhook-secret",
];

/**
 * Strip credentials from anything about to be logged.
 *
 * Recurses, because tokens arrive nested inside account payloads.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.some((s) => key.toLowerCase().includes(s))
      ? "[redacted]"
      : redact(v, depth + 1);
  }
  return out;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | string[] | number | undefined>;
  body?: unknown;
  /** Bounded retries for transient failures. */
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, POST_FOR_ME_CONFIG.baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    // Repeated keys are how the API expresses OR filters
    // (e.g. ?external_id=a&external_id=b).
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, String(v));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform one API call, with timeout and bounded retry.
 *
 * Throws `SocialPublishingError` for every failure path, so callers never see a
 * raw fetch error or an HTTP status.
 */
export async function postForMeRequest<T>(options: RequestOptions): Promise<T> {
  const apiKey = requirePostForMeApiKey();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const url = buildUrl(options.path, options.query);
  const method = options.method ?? "GET";

  let lastError: SocialPublishingError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      POST_FOR_ME_CONFIG.requestTimeoutMs
    );

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }

      const code = codeForHttpStatus(response.status);
      const detail = await safeReadBody(response);
      lastError = new SocialPublishingError(
        code,
        `Post for Me ${method} ${options.path} failed (${response.status}).`,
        { status: response.status }
      );

      // Log the shape of the failure, never the credential that caused it.
      console.error("[post-for-me] request failed", {
        method,
        path: options.path,
        status: response.status,
        code,
        attempt,
        detail: redact(detail),
      });

      if (!lastError.retryable || attempt === maxAttempts) throw lastError;
    } catch (err) {
      if (err instanceof SocialPublishingError) {
        if (!err.retryable || attempt === maxAttempts) throw err;
        lastError = err;
      } else {
        const aborted = err instanceof Error && err.name === "AbortError";
        lastError = new SocialPublishingError(
          aborted ? "timeout" : "network",
          aborted
            ? `Post for Me ${method} ${options.path} timed out.`
            : `Post for Me ${method} ${options.path} could not be reached.`,
          { cause: err }
        );
        console.error("[post-for-me] transport error", {
          method,
          path: options.path,
          code: lastError.code,
          attempt,
        });
        if (attempt === maxAttempts) throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }

    // Exponential backoff with jitter, so concurrent retries do not synchronise.
    const backoff = 300 * 2 ** (attempt - 1);
    await sleep(backoff + Math.floor(Math.random() * 200));
  }

  throw (
    lastError ??
    new SocialPublishingError("unknown", `Post for Me ${method} ${options.path} failed.`)
  );
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return null;
  }
}
