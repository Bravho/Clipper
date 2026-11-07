/**
 * Builds the run screen's entry input from configuration and the phone's own
 * pieces. Validation of the test place happens in the entry (before any
 * reservation); here it is only read. Pure except for the injected functions.
 */
import type { LabEntryInput } from "@/lib/lab/labEntry";
import { labTestPlaceFromEnv, createLabStudioIo, type StudioBindingDeps } from "@/lib/lab/labStudioIo";
import { createLabRunSteps } from "@/lib/lab/labRuntime";
import type { LabSpendLedger } from "@/lib/lab/labSpendLedger";
import { RunArtifactRegistry } from "@/lib/lab/labRuntime";
import type { LabLiveGuard } from "@/lib/lab/labGuards";

export interface ScreenPieces {
  env: Record<string, string | undefined>;
  identity: LabEntryInput["identity"];
  ledger: LabSpendLedger | Pick<LabSpendLedger, "reserve" | "markSpendAttempt" | "hasSpendAttempt" | "settle" | "release" | "usedToday">;
  guard: LabLiveGuard;
  runId: string;
  prepareSource: StudioBindingDeps["prepareSource"];
  fetchJson: StudioBindingDeps["fetchJson"];
  fetchBlob: StudioBindingDeps["fetchBlob"];
  fileNames: string[];
}

export function buildLabScreenInput(p: ScreenPieces): Omit<LabEntryInput, "providerExecutionEnabled"> {
  const testPlace = labTestPlaceFromEnv(p.env);
  const registry = new RunArtifactRegistry();
  const io = createLabStudioIo({
    ledger: p.ledger,
    guard: p.guard,
    registry,
    runId: p.runId,
    prepareSource: p.prepareSource,
    testPlace: testPlace ?? { placeName: "", latitude: 0, longitude: 0 },
    fetchJson: p.fetchJson,
    fetchBlob: p.fetchBlob,
    maxRenderSteps: 20,
  });
  return {
    flagValue: p.env.NEXT_PUBLIC_LAB_AUTORUN,
    identity: p.identity,
    ledger: p.ledger as LabSpendLedger,
    io,
    clientOptions: { testPlace, waitMaxAttempts: 60, waitIntervalMs: 2000 },
    guard: p.guard,
    fileNames: p.fileNames,
    newRunId: () => p.runId,
  };
}
