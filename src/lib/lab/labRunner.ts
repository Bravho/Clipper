/**
 * Runner entry point for one lab run.
 *
 * Order, and why:
 *  0. Provider execution is disabled in code (LAB_PROVIDER_EXECUTION_ENABLED).
 *     While it is false, nothing is reserved and nothing runs.
 *  1. Flag off = nothing happens.
 *  2. Quote the run's cost, reserve it (refused if it does not fit the caps).
 *  3. Run the steps. Before the first chargeable request, the steps call
 *     `beforeSpend`, which persists a spend-attempt marker. If the marker cannot
 *     be persisted, the call throws and nothing is dispatched.
 *  4. Outcome:
 *     - done: settle (charge the reserved amount).
 *     - otherwise: release ONLY if no marker exists (the marker is the proof that a
 *       request was dispatched; no marker = nothing dispatched). A marker, or an
 *       unreadable state, keeps the reservation for manual resolution.
 *
 * Known-unspent is never inferred from a step name. A failed submit with a marker
 * stays reserved, because a timeout can mean the server acted.
 */

import type { LabSpendLedger, ReserveResult } from "@/lib/lab/labSpendLedger";
import { LAB_PROVIDER_EXECUTION_ENABLED as PRODUCTION_PROVIDER_FLAG } from "@/lib/lab/labGuards";

/**
 * Paid providers (voice, script, scene, overlay, render) are NOT authorised.
 * This is a code constant, not an environment variable, so it cannot be turned
 * on by accident. Changing it needs a code change and Tho's approval.
 */
export { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";

export class SpendMarkerError extends Error {
  constructor() {
    super("The spend-attempt marker could not be saved, so nothing was sent.");
    this.name = "SpendMarkerError";
  }
}

export interface LabRunOutcome {
  status: "done" | "failed" | "cancelled";
  /** For a failure, the step name where it stopped. Informational only. */
  step?: string;
}

export interface LabRunnerDeps {
  flagOn(): boolean;
  ledger: Pick<LabSpendLedger, "reserve" | "settle" | "release" | "markSpendAttempt" | "hasSpendAttempt">;
  quoteCredits(): Promise<number>;
  newRunId(): string;
  /** Runs the lab steps. Must await `beforeSpend` before the first chargeable request. */
  runSteps(runId: string, beforeSpend: () => Promise<void>): Promise<LabRunOutcome>;
  /** Overridable only in tests; production uses the constant above. */
  providerExecutionEnabled?: boolean;
}

export type LabRunnerResult =
  | { status: "disabled" }
  | { status: "refused"; reason: string }
  | {
      status: "ended";
      runId: string;
      outcome: LabRunOutcome;
      ledger: "settled" | "released" | "kept_reserved";
      /** Whether a spend-attempt marker existed at the end (null = unknown). */
      spendAttempted: boolean | null;
    };

export async function runLabOnce(deps: LabRunnerDeps): Promise<LabRunnerResult> {
  if (!deps.flagOn()) return { status: "disabled" };
  const providersOn = deps.providerExecutionEnabled ?? PRODUCTION_PROVIDER_FLAG;
  if (!providersOn) return { status: "refused", reason: "provider_execution_disabled" };

  const runId = deps.newRunId();
  const credits = await deps.quoteCredits();
  const reserved: ReserveResult = await deps.ledger.reserve(runId, credits);
  if (!reserved.ok) return { status: "refused", reason: reserved.reason };

  const beforeSpend = async () => {
    const persisted = await deps.ledger.markSpendAttempt(runId);
    if (!persisted) throw new SpendMarkerError();
  };

  let outcome: LabRunOutcome;
  try {
    outcome = await deps.runSteps(runId, beforeSpend);
  } catch {
    // Crash or unexpected error: decide from the persisted marker below.
    outcome = { status: "failed" };
  }

  if (outcome.status === "done") {
    await deps.ledger.settle(runId);
    return { status: "ended", runId, outcome, ledger: "settled", spendAttempted: true };
  }

  const attempted = await deps.ledger.hasSpendAttempt(runId);
  if (attempted === false) {
    // No marker: no chargeable request was dispatched. Known-unspent.
    await deps.ledger.release(runId);
    return { status: "ended", runId, outcome, ledger: "released", spendAttempted: false };
  }
  // A marker exists, or the state is unreadable: keep the reservation.
  return { status: "ended", runId, outcome, ledger: "kept_reserved", spendAttempted: attempted };
}
