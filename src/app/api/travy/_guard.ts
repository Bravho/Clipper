/**
 * Shared guard for every /api/travy route.
 *
 * These routes are called server-to-server by the Travy admin backend, not by a
 * browser, so they authenticate with a shared secret (`RCLIPPER_API_KEY`) sent
 * as the `X-API-Key` header rather than with a NextAuth session.
 *
 * The identical secret must be present in Travy's `backend/.env` as
 * `RCLIPPER_API_KEY`. See RCLIPPER_INTEGRATION.md in the Travy repo.
 *
 * Follows the same explicit-call convention as `api/management/_guard.ts`:
 * each route calls this itself, there is no middleware magic.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type ApiKeyGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Constant-time string comparison.
 *
 * A plain `===` exits at the first differing byte, which leaks the expected
 * value one character at a time to an attacker who can measure response time.
 * `timingSafeEqual` throws on length mismatch, so length is checked separately
 * (leaking only the key's length, which is not sensitive).
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireTravyApiKey(request: Request): ApiKeyGuardResult {
  const expected = process.env.RCLIPPER_API_KEY;

  // Misconfiguration is a server fault, not an auth failure — and we must never
  // fall through to "no key configured means everyone is allowed".
  if (!expected) {
    console.error("[api/travy] RCLIPPER_API_KEY is not configured");
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Integration not configured." },
        { status: 500 }
      ),
    };
  }

  const provided = request.headers.get("x-api-key") ?? "";

  if (!provided || !secretsMatch(provided, expected)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid API key." }, { status: 401 }),
    };
  }

  return { ok: true };
}
