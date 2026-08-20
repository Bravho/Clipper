import { NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/auth/helpers";

/**
 * Uniform error responses for admin route handlers.
 *
 * The existing admin routes return `{ error }` with status 400 for absolutely
 * everything, including auth failures (a side effect of using the page helper
 * `requireRole`, whose internal `redirect()` throws). New admin endpoints use
 * this instead so that an unauthorised call is a real 401/403 and a genuine
 * server fault is a 500.
 *
 * The response body shape stays `{ error: string }` — the shape every admin
 * client component in this codebase already reads off a failed response.
 */
export function apiErrorResponse(err: unknown): NextResponse {
  // Next signals control flow by THROWING — `redirect()`, `notFound()`, and the
  // dynamic-server bailout all raise errors carrying a `digest` the framework
  // expects to catch itself. Converting one of those into a JSON 500 is exactly
  // the bug this helper exists to fix (the old routes did it to `redirect()`),
  // so rethrow anything that belongs to the framework before classifying.
  if (isNextControlFlowError(err)) {
    throw err;
  }

  if (err instanceof ApiAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  if (err instanceof ApiValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  if (err instanceof ApiNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }

  // Anything else is a bug, not a client mistake. Log it — the admin surface
  // has no other error channel — and do not leak internals to the caller.
  console.error("[admin-api] unhandled error:", err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

/**
 * Is this one of Next's internal throw-to-signal errors?
 *
 * Next tags them with a `digest` string: `NEXT_REDIRECT`, `NEXT_NOT_FOUND`, and
 * `DYNAMIC_SERVER_USAGE` (raised when a route reads `headers()`/`cookies()`
 * while Next is probing whether it can be prerendered — which every
 * session-reading admin route does at build time).
 */
function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return digest.startsWith("NEXT_") || digest === "DYNAMIC_SERVER_USAGE";
}

/** A caller-supplied value was rejected. Answers 400. */
export class ApiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiValidationError";
  }
}

/** The addressed resource does not exist. Answers 404. */
export class ApiNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "ApiNotFoundError";
  }
}
