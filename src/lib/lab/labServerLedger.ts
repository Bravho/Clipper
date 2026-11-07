/**
 * The one place the server opens the lab spend ledger (file storage plus lock),
 * for the lab routes. Server-only: it uses Node file access.
 */
import path from "node:path";
import { LabSpendLedger, createFileLedgerStorage, createFileLock } from "@/lib/lab/labSpendLedger";

export function labLedgerDir(): string {
  return process.env.LAB_LEDGER_DIR ?? path.join("D:\coding\ai_line_work", "lab-ledger");
}

export function openServerLedger(): LabSpendLedger {
  const dir = labLedgerDir();
  return new LabSpendLedger(
    createFileLedgerStorage(path.join(dir, "ledger.json")),
    undefined,
    undefined,
    createFileLock(path.join(dir, "ledger.lock"), { timeoutMs: 10_000, retryMs: 25 })
  );
}
