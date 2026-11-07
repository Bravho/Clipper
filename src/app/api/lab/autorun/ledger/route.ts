import { NextResponse } from "next/server";
import path from "node:path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { handleLedgerApi } from "@/lib/lab/labLedgerApi";
import { LabSpendLedger, createFileLedgerStorage, createFileLock } from "@/lib/lab/labSpendLedger";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";

/**
 * POST /api/lab/autorun/ledger  (lab only; see src/lib/lab/labLedgerApi.ts)
 * One file ledger on the Mar-PC, with its lock. Off (404) unless the flag is on
 * and provider execution is enabled in code.
 */
const LEDGER_DIR = process.env.LAB_LEDGER_DIR ?? path.join("D:\\coding\\ai_line_work", "lab-ledger");

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const body: unknown = await request.json().catch(() => null);
  const ledger = new LabSpendLedger(
    createFileLedgerStorage(path.join(LEDGER_DIR, "ledger.json")),
    undefined,
    undefined,
    createFileLock(path.join(LEDGER_DIR, "ledger.lock"), { timeoutMs: 10_000, retryMs: 25 })
  );
  const result = await handleLedgerApi(body, {
    flagValue: process.env.LAB_AUTORUN_ENABLED,
    providerExecutionEnabled: LAB_PROVIDER_EXECUTION_ENABLED,
    identity: {
      flagValue: process.env.LAB_AUTORUN_ENABLED,
      labEmail: process.env.DEVICE_RENDER_LAB_TEST_EMAIL,
      requesterRole: Role.Requester,
      session: session?.user
        ? { user: { id: session.user.id ?? null, role: session.user.role ?? null, email: session.user.email ?? null } }
        : null,
    },
    ledger,
  });
  return NextResponse.json(result.body, { status: result.status });
}
