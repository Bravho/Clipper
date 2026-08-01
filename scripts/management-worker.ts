/**
 * RClipper Management job worker.
 *
 * Drains `management_jobs` — currently the publication-reconcile queue — using
 * the same claim/heartbeat/reclaim seam as the render worker (migration 010's
 * pattern): claim a runnable row with FOR UPDATE SKIP LOCKED, do the work, mark
 * it done, and let a stale claim be reclaimed so a crashed worker never wedges a
 * job. Every job is idempotent, so a reclaim that runs one twice is safe.
 *
 * Run (from the repo root, with the server env populated):
 *
 *   npx tsx scripts/management-worker.ts           # long-running
 *   npx tsx scripts/management-worker.ts --once    # claim+run at most one, exit
 *
 * Env knobs (all optional):
 *   MGMT_WORKER_POLL_MS         idle poll interval (default 5000)
 *   MGMT_WORKER_STALE_CLAIM_MS  a claim older than this is reclaimable (default 120000)
 *   MGMT_WORKER_BACKOFF_MS      requeue delay when a publication is not yet final (default 30000)
 */

import "./bootstrapEnv";

import * as os from "os";
import { managementJobRepository } from "@/repositories/index";
import { managementReconcileService } from "@/services/management/ManagementReconcileService";
import { managementUploadRetentionService } from "@/services/management/ManagementUploadRetentionService";
import { managementTransferRetentionService } from "@/services/management/ManagementTransferRetentionService";
import { ManagementJobKind } from "@/domain/enums/ManagementStatus";
import type { ManagementJob } from "@/domain/models/ManagementJob";

const RUN_ONCE = process.argv.includes("--once");
const WORKER_ID = `mgmt#${os.hostname()}#${process.pid}`;
const POLL_MS = Number(process.env.MGMT_WORKER_POLL_MS ?? "5000");
const STALE_CLAIM_MS = Number(process.env.MGMT_WORKER_STALE_CLAIM_MS ?? "120000");
const BACKOFF_MS = Number(process.env.MGMT_WORKER_BACKOFF_MS ?? "30000");

let shuttingDown = false;

function log(msg: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  console.log(`[mgmt-worker ${WORKER_ID}] ${ts} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run one claimed job. Returns nothing — outcome is recorded on the queue. */
async function runJob(job: ManagementJob): Promise<void> {
  const now = new Date();

  if (job.kind === ManagementJobKind.ReconcilePublication) {
    const publicationId = String(job.payload?.publicationId ?? "");
    if (!publicationId) {
      await managementJobRepository.fail(job.id, "missing publicationId", {
        retryable: false,
        backoffMs: 0,
        now,
      });
      return;
    }
    try {
      const result = await managementReconcileService.reconcile(publicationId, now);
      if (result.done) {
        await managementJobRepository.complete(job.id);
        log("reconciled", { publicationId, status: result.status });
      } else {
        // Not yet final — requeue with backoff (a retryable "failure" that just
        // re-arms the row rather than erroring).
        await managementJobRepository.fail(job.id, "publication not yet final", {
          retryable: true,
          backoffMs: BACKOFF_MS,
          now,
        });
        log("requeued", { publicationId, status: result.status });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await managementJobRepository.fail(job.id, message, {
        retryable: true,
        backoffMs: BACKOFF_MS,
        now,
      });
      log("reconcile error, requeued", { publicationId, error: message });
    }
    return;
  }

  if (job.kind === ManagementJobKind.ExtendUploadRetention) {
    const userId = String(job.payload?.userId ?? "");
    if (!userId) {
      await managementJobRepository.fail(job.id, "missing userId", {
        retryable: false,
        backoffMs: 0,
        now,
      });
      return;
    }
    try {
      const moved = await managementUploadRetentionService.extendForUser(userId, now);
      // A management purchase also promotes the buyer's transferred generation
      // videos from the short free window into the paid management_retained/ one.
      const movedTransfers =
        await managementTransferRetentionService.extendForUser(userId, now);
      await managementJobRepository.complete(job.id);
      log("retention extended", {
        userId,
        movedUploadFiles: moved,
        movedTransferFiles: movedTransfers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await managementJobRepository.fail(job.id, message, {
        retryable: true,
        backoffMs: BACKOFF_MS,
        now,
      });
      log("retention extend error, requeued", { userId, error: message });
    }
    return;
  }

  // Unknown kind — not something this worker knows how to do. Fail permanently
  // so it does not spin, and surface it in the log.
  await managementJobRepository.fail(job.id, `unhandled job kind: ${job.kind}`, {
    retryable: false,
    backoffMs: 0,
    now,
  });
  log("unhandled job kind", { kind: job.kind });
}

/** Claim and run one job. Returns true when a job was claimed. */
async function tick(): Promise<boolean> {
  const now = new Date();
  const job = await managementJobRepository.claimNext(WORKER_ID, now, STALE_CLAIM_MS);
  if (!job) return false;
  await managementJobRepository.heartbeat(job.id, WORKER_ID, new Date()).catch(() => undefined);
  await runJob(job);
  return true;
}

async function main(): Promise<void> {
  log("starting", { runOnce: RUN_ONCE, pollMs: POLL_MS });

  if (RUN_ONCE) {
    await tick();
    log("done (--once)");
    return;
  }

  while (!shuttingDown) {
    let worked = false;
    try {
      worked = await tick();
    } catch (err) {
      log("tick error", { error: err instanceof Error ? err.message : String(err) });
    }
    // Only idle-wait when there was nothing to do; drain the queue eagerly.
    if (!worked) await sleep(POLL_MS);
  }
  log("shutting down");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log(`received ${sig}`);
    shuttingDown = true;
  });
}

main().catch((err) => {
  log("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
