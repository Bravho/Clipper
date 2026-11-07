/**
 * The one entry point for a lab run. Order of checks, all before any io call:
 *  1. flag exactly "true";
 *  2. provider execution enabled (code constant in production);
 *  3. the caller's identity is the exact lab account.
 * Then runLabOnce: quote, reserve, marker, steps. The marker is persisted before
 * the first server write (the draft).
 */
import { runLabOnce, type LabRunnerResult } from "@/lib/lab/labRunner";
import type { LabSpendLedger } from "@/lib/lab/labSpendLedger";

/** What the entry needs from a ledger: the local file ledger, or the server-backed client on the phone. */
export type LabLedgerPort = Pick<LabSpendLedger, "reserve" | "markSpendAttempt" | "hasSpendAttempt" | "settle" | "release" | "usedToday">;
import { createLabRunSteps } from "@/lib/lab/labRuntime";
import { createLabClient, type LabClientOptions, type LabIo } from "@/lib/lab/labClient";
import { labMaxRunCredits, LAB_FIXED_CHANNELS, LAB_FIXED_DURATION_SECONDS } from "@/lib/lab/labCostBasis";
import { decideLabIdentity } from "@/lib/lab/labSteps";
import type { LabLiveGuard } from "@/lib/lab/labGuards";

/** Test-place check, run BEFORE any reservation or marker. */
export function testPlaceProblem(place: LabClientOptions["testPlace"]): string | null {
  if (!place) return "no_test_place";
  if (typeof place.placeName !== "string" || place.placeName.trim().length < 1 || place.placeName.length > 150) {
    return "test_place_name_invalid";
  }
  if (!Number.isFinite(place.latitude) || place.latitude < -90 || place.latitude > 90) return "test_place_latitude_invalid";
  if (!Number.isFinite(place.longitude) || place.longitude < -180 || place.longitude > 180) return "test_place_longitude_invalid";
  return null;
}

export interface LabEntryInput {
  flagValue: string | undefined;
  /** Production passes LAB_PROVIDER_EXECUTION_ENABLED. Tests inject their own value. */
  providerExecutionEnabled: boolean;
  identity: Parameters<typeof decideLabIdentity>[0];
  ledger: LabLedgerPort;
  io: LabIo;
  clientOptions: Omit<LabClientOptions, "live">;
  /** Live kill switch, read before every new action and inside every wait. */
  guard: LabLiveGuard;
  fileNames: string[];
  newRunId(): string;
}

export type LabEntryResult = { status: "refused"; reason: string } | LabRunnerResult;

export async function runLabEntry(input: LabEntryInput): Promise<LabEntryResult> {
  if (input.flagValue !== "true") return { status: "refused", reason: "flag_off" };
  if (!input.providerExecutionEnabled) return { status: "refused", reason: "provider_execution_disabled" };
  const identity = decideLabIdentity(input.identity);
  if (!identity.ok) return { status: "refused", reason: identity.reason };

  if (input.guard.isStopped()) return { status: "refused", reason: "stopped" };
  const placeProblem = testPlaceProblem(input.clientOptions.testPlace);
  if (placeProblem) return { status: "refused", reason: placeProblem };

  const quote = labMaxRunCredits(LAB_FIXED_DURATION_SECONDS, LAB_FIXED_CHANNELS);
  if (!quote.ok) return { status: "refused", reason: quote.reason };

  const client = createLabClient(input.io, { ...input.clientOptions, live: input.guard });
  const steps = createLabRunSteps(client, {
    flagOn: () => input.flagValue === "true" && !input.guard.isStopped(),
    fileNames: input.fileNames,
  });
  return runLabOnce({
    flagOn: () => input.flagValue === "true" && !input.guard.isStopped(),
    ledger: input.ledger,
    quoteCredits: async () => quote.maxCredits,
    newRunId: input.newRunId,
    runSteps: steps,
    providerExecutionEnabled: input.providerExecutionEnabled,
  });
}
