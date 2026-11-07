/**
 * Lab auto-run access rules, in one place so they can be tested without a
 * live login.
 *
 * Two ways in, and both are off unless LAB_AUTORUN_ENABLED is exactly "true":
 *  - the runner: a bearer token (LAB_RUNNER_TOKEN) sent by the Mar-PC runner.
 *    The token never goes to phone or browser code.
 *  - the test phone: a signed-in session whose role is Requester and whose
 *    email is exactly the lab test account (DEVICE_RENDER_LAB_TEST_EMAIL).
 *
 * Any other account, a missing flag, or a missing or wrong token is refused.
 */

import { timingSafeEqual } from "node:crypto";

export type LabAccessDecision =
  | { ok: true; via: "runner-token" | "lab-session" }
  | { ok: false; status: 401 | 404; reason: string };

export interface LabSessionLike {
  user?: { role?: string | null; email?: string | null } | null;
}

export interface LabAccessInput {
  env: Record<string, string | undefined>;
  authorizationHeader: string | null;
  session: LabSessionLike | null;
  /** Role value that means "requester" (passed in so this file stays dependency-free). */
  requesterRole: string;
}

export function labAutoRunEnabled(env: Record<string, string | undefined>): boolean {
  return env.LAB_AUTORUN_ENABLED === "true";
}

/** Constant-time comparison of two strings of any length. */
export function tokenEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerTokenFrom(authorizationHeader: string | null): string | null {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function isLabAccount(
  session: LabSessionLike | null,
  labEmail: string,
  requesterRole: string
): boolean {
  if (!labEmail) return false;
  const email = (session?.user?.email ?? "").trim().toLowerCase();
  return session?.user?.role === requesterRole && email === labEmail.trim().toLowerCase();
}

const LAB_MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

/**
 * A file name that is safe to look up in the fixed lab folder: a plain name,
 * no separators, no parent references, and an allowed video extension.
 */
export function isSafeLabMediaName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.includes("\0")) return false;
  if (name !== name.trim() || name.startsWith(".")) return false;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return LAB_MEDIA_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * Decide whether a lab auto-run request may proceed.
 * Flag first: when the flag is off, nothing is reachable (404, same as a
 * route that does not exist). Then the runner token, then the lab session.
 */
export function decideLabAccess(input: LabAccessInput): LabAccessDecision {
  if (!labAutoRunEnabled(input.env)) {
    return { ok: false, status: 404, reason: "flag_off" };
  }

  const expected = input.env.LAB_RUNNER_TOKEN ?? "";
  const presented = bearerTokenFrom(input.authorizationHeader);
  if (input.authorizationHeader !== null) {
    // A bearer header means "I am the runner". A wrong or empty one is refused
    // even if a lab session is also present.
    if (expected && presented && tokenEquals(presented, expected)) {
      return { ok: true, via: "runner-token" };
    }
    return { ok: false, status: 401, reason: "bad_runner_token" };
  }

  const labEmail = input.env.DEVICE_RENDER_LAB_TEST_EMAIL ?? "";
  if (isLabAccount(input.session, labEmail, input.requesterRole)) {
    return { ok: true, via: "lab-session" };
  }

  return { ok: false, status: 401, reason: "not_authorised" };
}
