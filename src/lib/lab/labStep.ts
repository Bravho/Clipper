/**
 * Lab step route logic. Every automated lab call goes through here. Checks, in order:
 *  1. the action is on the explicit allow-list, and the ids are plain identifiers;
 *  2. the signed-in account is exactly the lab test account (Requester role);
 *  3. the request exists and is owned by that same account;
 *  4. the run exists (marker, owned by the same account);
 *  5. the run is linked to THIS request, and an attempt is linked to THIS run;
 *  6. stop rules: new work needs the flag and provider switch on; finish needs an
 *     upload authorised earlier; progress and release are always allowed for a
 *     linked attempt, so a stop can still clean up.
 * Only then is the normal studio or device-render route called, with the same
 * session, so the normal route's own checks still apply.
 */

import { isLabRouteAction, isSafeLabId, labStopClass, LAB_ROUTE_TEMPLATES, buildLabRouteUrl, type LabRouteAction } from "@/lib/lab/labRouteTable";

export interface LabStepInput {
  requestId: string;
  action: string;
  payload: unknown;
  /** The lab run this step belongs to. Required for every action. */
  runId?: string;
  /** Required for actions on an attempt (see the route table). */
  attemptId?: string;
}

export interface LabRunBinding {
  requestId: string | null;
  attemptIds: string[];
  uploadAuthorised: string[];
}

/** Upper bound for the server-side release of a stranded claim. */
export const STRANDED_RELEASE_TIMEOUT_MS = 5_000;

/**
 * Releases a claim the server made but the lab could not link. Calls the one
 * device-release route directly (the attempt is not linked yet, so the step checks
 * do not apply to this internal call). Returns true only for a 2xx answer, and
 * never waits longer than STRANDED_RELEASE_TIMEOUT_MS.
 */
export async function releaseStrandedClaim(
  deps: Pick<LabStepDeps, "forward">,
  ids: { requestId: string; attemptId: string },
  timeoutMs: number = STRANDED_RELEASE_TIMEOUT_MS
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("release timed out")), timeoutMs);
    });
    const result = await Promise.race([
      deps.forward("device-release", ids, { reason: "claim could not be linked to its run" }),
      timedOut,
    ]);
    return result.status >= 200 && result.status < 300;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface LabStepDeps {
  flagValue: string | undefined;
  /** Paid provider work is refused unless this is true. Production passes the code constant (false). */
  providerExecutionEnabled: boolean;
  labEmail: string | undefined;
  requesterRole: string;
  getSession(): Promise<{ user?: { id?: string | null; role?: string | null; email?: string | null } | null } | null>;
  findRequestOwner(requestId: string): Promise<string | null>;
  /** True only when the owner's spend-attempt marker exists for this run. */
  markerExists(ownerId: string, runId: string): Promise<boolean>;
  /** The run's links (request, attempts, authorised uploads), or null when unknown. */
  getBinding(ownerId: string, runId: string): Promise<LabRunBinding | null>;
  /** Links an attempt claimed for this run to this request. */
  bindAttempt(ownerId: string, runId: string, requestId: string, attemptId: string): Promise<boolean>;
  /** Records that an attempt's upload was authorised. */
  authoriseUpload(ownerId: string, runId: string, attemptId: string): Promise<boolean>;
  /** Records a claim that could be neither linked nor released, for a person to resolve. */
  recordUnresolvedClaim(ownerId: string, runId: string, attemptId: string): Promise<boolean>;
  /** Calls the one normal route for the action, with the caller's own session. */
  forward(action: LabRouteAction, ids: { requestId: string; attemptId?: string }, payload: unknown): Promise<{ status: number; body: unknown }>;
}

export type LabStepResult = { status: number; body: unknown };

const NOT_FOUND = { status: 404, body: { error: "Not found." } };

export async function handleLabStep(input: LabStepInput, deps: LabStepDeps): Promise<LabStepResult> {
  // 1. Allow-list and plain ids.
  if (!isLabRouteAction(input.action)) return { status: 400, body: { error: "Unknown lab action." } };
  const action = input.action;
  const template = LAB_ROUTE_TEMPLATES[action];
  if (!isSafeLabId(input.requestId)) return { status: 400, body: { error: "Bad request id." } };
  if (template.attempt && !isSafeLabId(input.attemptId)) return { status: 400, body: { error: "Bad attempt id." } };

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
  const ownerId = user!.id as string;

  // 3. Stop rules. New work needs the switches on; the others are decided below.
  const switchesOn = deps.flagValue === "true" && deps.providerExecutionEnabled;
  const cls = labStopClass(action);
  if (cls === "new-work" && !switchesOn) return NOT_FOUND;

  // 4. The request must be the signed-in account's own.
  const owner = await deps.findRequestOwner(input.requestId);
  if (owner === null || owner !== ownerId) return NOT_FOUND;

  // 5. The run must be recorded for this owner, and linked to this request.
  if (!input.runId || !isSafeLabId(input.runId)) return { status: 409, body: { error: "No lab run." } };
  if (!(await deps.markerExists(ownerId, input.runId))) return { status: 409, body: { error: "No recorded lab run." } };
  const binding = await deps.getBinding(ownerId, input.runId);
  if (!binding || binding.requestId !== input.requestId) return { status: 409, body: { error: "Run and request do not match." } };

  // 6. Attempts: the attempt must be linked to THIS run. A finish needs an authorised upload.
  if (template.attempt) {
    if (!binding.attemptIds.includes(input.attemptId as string)) return { status: 409, body: { error: "Attempt is not part of this run." } };
    if (cls === "finish" && !binding.uploadAuthorised.includes(input.attemptId as string)) {
      return { status: 409, body: { error: "Upload was not authorised for this attempt." } };
    }
  }

  // 7. A claim may only be made for this request.
  if (action === "device-claim") {
    const claimed = (input.payload as { requestId?: unknown } | null)?.requestId;
    if (claimed !== input.requestId) return { status: 409, body: { error: "Claim is for another request." } };
  }

  if (!buildLabRouteUrl(action, { requestId: input.requestId, attemptId: input.attemptId })) {
    return { status: 400, body: { error: "No route for this action." } };
  }

  const result = await deps.forward(action, { requestId: input.requestId, attemptId: input.attemptId }, input.payload);

  // 8. Record the links the server created, before the caller can use them.
  if (action === "device-claim" && result.status >= 200 && result.status < 300) {
    const attemptId = (result.body as { attemptId?: unknown } | null)?.attemptId;
    if (typeof attemptId !== "string" || !isSafeLabId(attemptId)) {
      return { status: 502, body: { error: "The claim did not return an attempt." } };
    }
    if (!(await deps.bindAttempt(ownerId, input.runId, input.requestId, attemptId))) {
      // The server holds a claim the phone will never use. Release it here, bounded, and
      // do not hand the attempt id out. If the release fails too, record it for a person.
      const released = await releaseStrandedClaim(deps, { requestId: input.requestId, attemptId });
      if (!released) await deps.recordUnresolvedClaim(ownerId, input.runId, attemptId);
      return { status: 409, body: { error: "The claimed attempt could not be linked to this run." } };
    }
  }
  if (action === "device-upload-authorize" && result.status >= 200 && result.status < 300) {
    if (!(await deps.authoriseUpload(ownerId, input.runId, input.attemptId as string))) {
      return { status: 409, body: { error: "The upload could not be recorded for this run." } };
    }
  }
  return result;
}
