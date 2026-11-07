/**
 * Lab auto-run step proxy: the one place a lab account may ask for a studio
 * mutation. Every call re-checks, on the server:
 *  1. the flag is exactly "true" right now (switching it off stops the next step);
 *  2. the signed-in account is exactly the lab test account, Requester role;
 *  3. the request exists and is owned by that same account;
 *  4. the action is on the allow-list.
 * Only then is the normal studio route called with the same session, so the
 * studio route's own checks still apply. Normal studio users never reach this.
 */

export const LAB_STEP_ACTIONS = [
  "start-production",
  "approve-voice",
  "scene-design-approve",
  "approve-overlay",
] as const;
export type LabStepAction = (typeof LAB_STEP_ACTIONS)[number];

export interface LabStepInput {
  requestId: string;
  action: string;
  payload: unknown;
}

export interface LabStepDeps {
  flagValue: string | undefined;
  labEmail: string | undefined;
  requesterRole: string;
  getSession(): Promise<{ user?: { id?: string | null; role?: string | null; email?: string | null } | null } | null>;
  findRequestOwner(requestId: string): Promise<string | null>;
  /** Calls the normal studio route for one action, with the caller's own session. */
  forward(action: LabStepAction, requestId: string, payload: unknown): Promise<{ status: number; body: unknown }>;
}

export type LabStepResult =
  | { status: number; body: unknown }
  | { status: 400 | 401 | 404 | 500; body: { error: string } };

export async function handleLabStep(input: LabStepInput, deps: LabStepDeps): Promise<LabStepResult> {
  // 1. Flag, right now. A step after the flag was switched off is refused.
  if (deps.flagValue !== "true") return { status: 404, body: { error: "Not found." } };

  // 2. Exact lab identity.
  const session = await deps.getSession();
  const user = session?.user ?? null;
  const labEmail = (deps.labEmail ?? "").trim().toLowerCase();
  const email = (user?.email ?? "").trim().toLowerCase();
  const isLab =
    labEmail.length > 0 &&
    user !== null &&
    user.role === deps.requesterRole &&
    email === labEmail &&
    typeof user.id === "string" &&
    user.id.length > 0;
  if (!isLab) return { status: 401, body: { error: "Unauthorised." } };

  // 3. Action allow-list.
  if (!(LAB_STEP_ACTIONS as readonly string[]).includes(input.action)) {
    return { status: 400, body: { error: "Unknown lab action." } };
  }

  // 4. Ownership, from the database, never from the body.
  if (!input.requestId) return { status: 404, body: { error: "Not found." } };
  const owner = await deps.findRequestOwner(input.requestId);
  if (owner === null || owner !== user!.id) return { status: 404, body: { error: "Not found." } };

  return deps.forward(input.action as LabStepAction, input.requestId, input.payload);
}
