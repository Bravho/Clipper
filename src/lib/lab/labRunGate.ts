/**
 * Server-side gate for starting a lab auto-run on one request.
 *
 * Checked on the server, in this order, before any lab step is allowed:
 *  1. the flag LAB_AUTORUN_ENABLED is exactly "true" (else 404);
 *  2. the caller is signed in with the Requester role and the exact lab test
 *     account email (else 401);
 *  3. the request exists and belongs to that same signed-in lab account (else
 *     404, so another owner's request is not revealed).
 *
 * The client check in labAutoRun.ts is extra protection only.
 */

export type LabRunGateDecision =
  | { ok: true }
  | { ok: false; status: 401 | 404; reason: "flag_off" | "not_lab_account" | "request_not_found_or_not_owned" };

export interface LabRunGateInput {
  flagValue: string | undefined;
  labEmail: string | undefined;
  requesterRole: string;
  session: { user?: { id?: string | null; role?: string | null; email?: string | null } | null } | null;
  /** The request's owner, or null when no such request exists. */
  requestOwnerId: string | null;
}

export function decideLabRunGate(input: LabRunGateInput): LabRunGateDecision {
  if (input.flagValue !== "true") {
    return { ok: false, status: 404, reason: "flag_off" };
  }

  const user = input.session?.user ?? null;
  const labEmail = (input.labEmail ?? "").trim().toLowerCase();
  const email = (user?.email ?? "").trim().toLowerCase();
  const isLab =
    labEmail.length > 0 &&
    user !== null &&
    user.role === input.requesterRole &&
    email === labEmail &&
    typeof user.id === "string" &&
    user.id.length > 0;
  if (!isLab) {
    return { ok: false, status: 401, reason: "not_lab_account" };
  }

  if (input.requestOwnerId === null || input.requestOwnerId !== user!.id) {
    return { ok: false, status: 404, reason: "request_not_found_or_not_owned" };
  }

  return { ok: true };
}
