/**
 * Server-side ledger API for the phone's lab run. The phone cannot read the
 * Mar-PC file ledger, so every ledger operation goes through here. Every call
 * checks, in order: flag, provider execution (code constant), exact lab identity.
 * Only then is the operation run on the single file ledger (with its lock).
 */
import { decideLabIdentity } from "@/lib/lab/labSteps";
import type { LabSpendLedger } from "@/lib/lab/labSpendLedger";

export type LedgerRequest =
  | { op: "reserve"; runId: string; credits: number }
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
      return typeof b.credits === "number" && runId ? { op: "reserve", runId, credits: b.credits } : null;
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

  switch (req.op) {
    case "reserve":
      return { status: 200, body: await deps.ledger.reserve(req.runId, req.credits) };
    case "markSpendAttempt":
      return { status: 200, body: { ok: await deps.ledger.markSpendAttempt(req.runId) } };
    case "hasSpendAttempt":
      return { status: 200, body: { value: await deps.ledger.hasSpendAttempt(req.runId) } };
    case "settle":
      return { status: 200, body: { ok: await deps.ledger.settle(req.runId) } };
    case "release":
      return { status: 200, body: { ok: await deps.ledger.release(req.runId) } };
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
    reserve: async (runId: string, credits: number) =>
      unwrap<{ ok: true } | { ok: false; reason: "run_over_cap" | "day_over_cap" | "ledger_unreadable" | "bad_amount" | "duplicate_run" }>(
        { op: "reserve", runId, credits },
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
