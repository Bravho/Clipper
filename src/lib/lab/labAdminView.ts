/**
 * Read-only view of the lab runs linked to one request, for the admin request page.
 * Reads the ledger file and changes nothing.
 */
import type { LabLedgerStorage } from "@/lib/lab/labSpendLedger";

export interface LabRunSummary {
  runId: string;
  attemptCount: number;
  uploadsAuthorised: number;
  markerRecorded: boolean;
  reservedCredits: number;
  unresolvedClaims: number;
}

/** Runs linked to `requestId`. Returns null when the ledger cannot be read (shown as unknown, not as "none"). */
export async function labRunsForRequest(storage: LabLedgerStorage, requestId: string): Promise<LabRunSummary[] | null> {
  let raw: unknown;
  try {
    raw = await storage.read();
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return [];
  if (typeof raw !== "object") return null;
  const state = raw as {
    runBindings?: Record<string, { requestId: string | null; attemptIds?: string[]; uploadAuthorised?: string[] }>;
    spendAttempted?: string[];
    reservations?: { runId: string; credits: number }[];
    unresolvedClaims?: { key: string }[];
  };
  const bindings = state.runBindings ?? {};
  const marked = new Set(state.spendAttempted ?? []);
  const reservations = state.reservations ?? [];
  const unresolved = state.unresolvedClaims ?? [];
  const out: LabRunSummary[] = [];
  for (const [key, b] of Object.entries(bindings)) {
    if (b.requestId !== requestId) continue;
    const runId = key.includes("::") ? key.slice(key.indexOf("::") + 2) : key;
    out.push({
      runId,
      attemptCount: (b.attemptIds ?? []).length,
      uploadsAuthorised: (b.uploadAuthorised ?? []).length,
      markerRecorded: marked.has(key),
      reservedCredits: reservations.filter((r) => r.runId === key).reduce((s, r) => s + r.credits, 0),
      unresolvedClaims: unresolved.filter((c) => c.key === key).length,
    });
  }
  return out;
}
