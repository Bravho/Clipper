/**
 * Server-side ledger API for the phone's lab run. The phone cannot read the
 * Mar-PC file ledger, so every ledger operation goes through here. Every call
 * checks, in order: flag, provider execution (code constant), exact lab identity.
 * Only then is the operation run on the single file ledger (with its lock).
 */
import { decideLabIdentity } from "@/lib/lab/labSteps";
import type { LabSpendLedger } from "@/lib/lab/labSpendLedger";
import { labMaxRunCredits, LAB_FIXED_CHANNELS, LAB_FIXED_DURATION_SECONDS } from "@/lib/lab/labCostBasis";

/**
 * Server-side rules for every ledger call:
 *  - The owner is the signed-in account, taken from the session. Every run id is
 *    stored under that owner (`owner::runId`), so one owner can never settle,
 *    release or read another owner's run, and a replayed id is refused.
 *  - The credit amount is computed here, never taken from the phone.
 *  - The phone's spend totals and marker claims are not trusted: the answers come
 *    from the server ledger, and release is refused by the ledger once a marker exists.
 */
export function ownedKey(ownerId: string, runId: string): string {
  return `${ownerId}::${runId}`;
}

export function serverRunQuote(): number {
  const quote = labMaxRunCredits(LAB_FIXED_DURATION_SECONDS, LAB_FIXED_CHANNELS);
  if (!quote.ok) throw new Error(`lab quote refused: ${quote.reason}`);
  return quote.maxCredits;
}

export type LedgerRequest =
  | { op: "reserve"; runId: string }
  | { op: "markSpendAttempt"; runId: string }
  | { op: "hasSpendAttempt"; runId: string }
  | { op: "settle"; runId: string }
  | { op: "release"; runId: string }
  | { op: "usedToday" };

export interface LedgerApiDeps {
  flagValue: string | undefined;
  providerExecutionEnabled: boolean;
  identity: Parameters<typeof decideLabIdentity>[0];
  ledger: Pick<LabSpendLedger, "reserve" | "markSpendAttempt" | "hasSpendAttempt" | "settle" | "release" | "usedToday">;
}

function parse(body: unknown): LedgerRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const runId = typeof b.runId === "string" ? b.runId : "";
  switch (b.op) {
    case "reserve":
      // Any credits field the phone sends is ignored: the server computes the amount.
      return runId ? { op: "reserve", runId } : null;
    case "markSpendAttempt":
    case "hasSpendAttempt":
    case "settle":
    case "release":
      return runId ? { op: b.op, runId } : null;
    case "usedToday":
      return { op: "usedToday" };
    default:
      return null;
  }
}

export async function handleLedgerApi(body: unknown, deps: LedgerApiDeps): Promise<{ status: number; body: unknown }> {
  if (deps.flagValue !== "true" || !deps.providerExecutionEnabled) return { status: 404, body: { error: "Not found." } };
  const identity = decideLabIdentity(deps.identity);
  if (!identity.ok) return { status: 401, body: { error: "Unauthorised." } };

  const req = parse(body);
  if (!req) return { status: 400, body: { error: "Bad ledger request." } };

  const owner = identity.userId;
  switch (req.op) {
    case "reserve":
      // The amount is the server's own quote; a phone-sent amount is ignored.
      return { status: 200, body: await deps.ledger.reserve(ownedKey(owner, req.runId), serverRunQuote()) };
    case "markSpendAttempt":
      return { status: 200, body: { ok: await deps.ledger.markSpendAttempt(ownedKey(owner, req.runId)) } };
    case "hasSpendAttempt":
      return { status: 200, body: { value: await deps.ledger.hasSpendAttempt(ownedKey(owner, req.runId)) } };
    case "settle":
      return { status: 200, body: { ok: await deps.ledger.settle(ownedKey(owner, req.runId)) } };
    case "release":
      return { status: 200, body: { ok: await deps.ledger.release(ownedKey(owner, req.runId)) } };
    case "usedToday":
      return { status: 200, body: { value: await deps.ledger.usedToday() } };
  }
}

/** Phone-side client: the same operations, over the server route. */
export function createRemoteLedger(post: (body: LedgerRequest) => Promise<{ status: number; body: unknown }>) {
  const unwrap = async <T>(req: LedgerRequest, pick: (b: unknown) => T, fallback: T): Promise<T> => {
    try {
      const res = await post(req);
      if (res.status !== 200) return fallback;
      return pick(res.body);
    } catch {
      return fallback;
    }
  };
  return {
    reserve: async (runId: string) =>
      unwrap<{ ok: true } | { ok: false; reason: "run_over_cap" | "day_over_cap" | "ledger_unreadable" | "bad_amount" | "duplicate_run" }>(
        { op: "reserve", runId },
        (b) => b as never,
        { ok: false, reason: "ledger_unreadable" }
      ),
    markSpendAttempt: (runId: string) =>
      unwrap<boolean>({ op: "markSpendAttempt", runId }, (b) => (b as { ok: boolean }).ok === true, false),
    hasSpendAttempt: (runId: string) =>
      unwrap<boolean | null>({ op: "hasSpendAttempt", runId }, (b) => (b as { value: boolean | null }).value, null),
    settle: (runId: string) => unwrap<boolean>({ op: "settle", runId }, (b) => (b as { ok: boolean }).ok === true, false),
    release: (runId: string) => unwrap<boolean>({ op: "release", runId }, (b) => (b as { ok: boolean }).ok === true, false),
    usedToday: () => unwrap<number | null>({ op: "usedToday" }, (b) => (b as { value: number | null }).value, null),
  };
}
