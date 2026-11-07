/**
 * Shared rules for the lab auto-run steps: draft gate, durable upload check,
 * bounded waiting with cancellation, and a duplicate-run guard. Pure logic, so
 * each rule is unit-tested without a server or a phone.
 */

export interface LabIdentityInput {
  flagValue: string | undefined;
  labEmail: string | undefined;
  requesterRole: string;
  session: { user?: { id?: string | null; role?: string | null; email?: string | null } | null } | null;
}

export type LabIdentityDecision =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 404; reason: "flag_off" | "not_lab_account" };

/**
 * Flag and lab identity only, for steps that have no request yet (draft
 * creation). The owner is taken from the session, never from the request body.
 */
export function decideLabIdentity(input: LabIdentityInput): LabIdentityDecision {
  if (input.flagValue !== "true") return { ok: false, status: 404, reason: "flag_off" };
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
  if (!isLab) return { ok: false, status: 401, reason: "not_lab_account" };
  return { ok: true, userId: user!.id as string };
}

export interface UploadFinishResult {
  /** From deviceRenderService.finishUpload: the multipart object was assembled. */
  finishOk: boolean;
}

export interface UploadCompleteResult {
  /** From deviceRenderService.complete: the server verified the object and created the asset. */
  ok: boolean;
  assetId: string | null;
}

/**
 * Durable upload confirmation. A render finishing on the phone is NOT enough.
 * Only when the multipart upload was assembled AND the server's complete call
 * verified the object and returned an asset id does the output count as stored.
 */
export function uploadIsDurable(finish: UploadFinishResult | null, complete: UploadCompleteResult | null): boolean {
  if (!finish || !complete) return false;
  return finish.finishOk === true && complete.ok === true && typeof complete.assetId === "string" && complete.assetId.length > 0;
}

export interface BoundedWaitOptions {
  maxAttempts: number;
  intervalMs: number;
  /** Abort the wait when this returns true (cancellation). */
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export type BoundedWaitResult<T> =
  | { status: "ready"; value: T; attempts: number }
  | { status: "timeout"; attempts: number }
  | { status: "cancelled"; attempts: number };

/**
 * Poll `check` until it returns a value (not null/undefined), the attempts run
 * out, or the caller cancels. Never waits longer than maxAttempts * intervalMs.
 */
export async function waitBounded<T>(
  check: () => Promise<T | null | undefined>,
  options: BoundedWaitOptions
): Promise<BoundedWaitResult<T>> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (options.isCancelled?.()) return { status: "cancelled", attempts: attempt - 1 };
    const value = await check();
    if (value !== null && value !== undefined) return { status: "ready", value, attempts: attempt };
    if (attempt < options.maxAttempts) await sleep(options.intervalMs);
  }
  return { status: "timeout", attempts: options.maxAttempts };
}

/**
 * One lab run at a time per key (the lab account). A second trigger while one
 * is active is refused, so a double tap or a retry cannot start a second run.
 */
export class LabRunGuard {
  private readonly active = new Set<string>();

  acquire(key: string): boolean {
    if (this.active.has(key)) return false;
    this.active.add(key);
    return true;
  }

  release(key: string): void {
    this.active.delete(key);
  }

  isActive(key: string): boolean {
    return this.active.has(key);
  }
}
