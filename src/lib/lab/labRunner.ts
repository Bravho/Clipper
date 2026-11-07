/**
 * Runner entry point for one lab run. Flag off = nothing happens. Otherwise:
 *  1. quote the run's cost (an upper bound, from the caller);
 *  2. reserve it in the spend ledger (refused if it does not fit the caps);
 *  3. run the lab steps, marking the point where the first charging call is made;
 *  4. settle the reservation if the run succeeded, or keep it if spend is uncertain;
 *     release it ONLY when the run provably stopped before any charging call.
 *
 * "Provably before any charge" means the run stopped at or before the draft and
 * fetch steps. Once submit has been attempted, spend may have happened, so the
 * reservation stays reserved for manual resolution.
 */

import type { LabSpendLedger, ReserveResult } from "@/lib/lab/labSpendLedger";

/** Steps that run before the first charging call (submit). */
export const LAB_STEPS_BEFORE_SPEND = ["fetch", "create_draft"] as const;

export interface LabRunOutcome {
  status: "done" | "failed" | "cancelled";
  /** For a failure, the step name where it stopped. */
  step?: string;
}

export interface LabRunnerDeps {
  flagOn(): boolean;
  ledger: Pick<LabSpendLedger, "reserve" | "settle" | "release">;
  quoteCredits(): Promise<number>;
  newRunId(): string;
  /** Runs the lab steps. Calls `markSpendAttempted` just before the submit call. */
  runSteps(runId: string, markSpendAttempted: () => void): Promise<LabRunOutcome>;
}

export type LabRunnerResult =
  | { status: "disabled" }
  | { status: "refused"; reason: string }
  | { status: "ended"; runId: string; outcome: LabRunOutcome; ledger: "settled" | "released" | "kept_reserved" };

export async function runLabOnce(deps: LabRunnerDeps): Promise<LabRunnerResult> {
  if (!deps.flagOn()) return { status: "disabled" };

  const runId = deps.newRunId();
  const credits = await deps.quoteCredits();
  const reserved: ReserveResult = await deps.ledger.reserve(runId, credits);
  if (!reserved.ok) return { status: "refused", reason: reserved.reason };

  let spendAttempted = false;
  let outcome: LabRunOutcome;
  try {
    outcome = await deps.runSteps(runId, () => {
      spendAttempted = true;
    });
  } catch {
    // An unexpected crash: whatever was attempted is unknown, so keep it reserved.
    outcome = { status: "failed", step: spendAttempted ? "submit" : "unknown" };
  }

  if (outcome.status === "done") {
    await deps.ledger.settle(runId);
    return { status: "ended", runId, outcome, ledger: "settled" };
  }

  if (!spendAttempted && outcome.step !== undefined && (LAB_STEPS_BEFORE_SPEND as readonly string[]).includes(outcome.step)) {
    await deps.ledger.release(runId);
    return { status: "ended", runId, outcome, ledger: "released" };
  }

  // Submit was attempted, or we cannot tell: keep the money reserved.
  return { status: "ended", runId, outcome, ledger: "kept_reserved" };
}
