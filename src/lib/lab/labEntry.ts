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
import { createLabRunSteps } from "@/lib/lab/labRuntime";
import { createLabClient, type LabClientOptions, type LabIo } from "@/lib/lab/labClient";
import { labMaxRunCredits, LAB_FIXED_CHANNELS, LAB_FIXED_DURATION_SECONDS } from "@/lib/lab/labCostBasis";
import { decideLabIdentity } from "@/lib/lab/labSteps";

export interface LabEntryInput {
  flagValue: string | undefined;
  /** Production passes LAB_PROVIDER_EXECUTION_ENABLED. Tests inject their own value. */
  providerExecutionEnabled: boolean;
  identity: Parameters<typeof decideLabIdentity>[0];
  ledger: LabSpendLedger;
  io: LabIo;
  clientOptions: LabClientOptions;
  fileNames: string[];
  newRunId(): string;
}

export type LabEntryResult = { status: "refused"; reason: string } | LabRunnerResult;

export async function runLabEntry(input: LabEntryInput): Promise<LabEntryResult> {
  if (input.flagValue !== "true") return { status: "refused", reason: "flag_off" };
  if (!input.providerExecutionEnabled) return { status: "refused", reason: "provider_execution_disabled" };
  const identity = decideLabIdentity(input.identity);
  if (!identity.ok) return { status: "refused", reason: identity.reason };

  const quote = labMaxRunCredits(LAB_FIXED_DURATION_SECONDS, LAB_FIXED_CHANNELS);
  if (!quote.ok) return { status: "refused", reason: quote.reason };

  const client = createLabClient(input.io, input.clientOptions);
  const steps = createLabRunSteps(client, { flagOn: () => true, fileNames: input.fileNames });
  return runLabOnce({
    flagOn: () => input.flagValue === "true",
    ledger: input.ledger,
    quoteCredits: async () => quote.maxCredits,
    newRunId: input.newRunId,
    runSteps: steps,
    providerExecutionEnabled: input.providerExecutionEnabled,
  });
}
