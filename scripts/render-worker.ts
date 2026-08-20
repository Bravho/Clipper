/**
 * RClipper render worker — Mac Mini processing unit.
 *
 * Long-running, OUTBOUND-ONLY process. It polls managed Postgres for the next
 * queued heavy pipeline STEP on the flat FIFO render-task line (render_tasks),
 * runs each by reusing the EXISTING compute in VideoGenerationService (which
 * streams its own inputs from DO Spaces and pushes outputs back with
 * ACL:"public-read" unchanged), then marks the task done. One step at a time
 * (RENDER_CONCURRENCY, default 1) so the Mac is never overloaded. No inbound
 * port, static IP, or tunnel is needed.
 *
 * The queue is ONE line mixed across all requesters — e.g. #1 user B's overlay,
 * #2 user A's merge, #3 user C's compose — claimed strictly oldest-first.
 *
 * Run (on the Mac, from the repo root, with .env.local populated — see
 * docs/mac-worker-setup.md):
 *
 *   npx tsx scripts/render-worker.ts            # long-running (launchd runs this)
 *   npx tsx scripts/render-worker.ts --once     # claim+run at most one step, then exit
 *
 * Config knobs live in src/config/renderQueue.ts (all env-overridable):
 *   RENDER_CONCURRENCY (1–2), RENDER_POLL_INTERVAL_MS, RENDER_HEARTBEAT_INTERVAL_MS,
 *   RENDER_STALE_CLAIM_SECONDS.
 */
import "./bootstrapEnv";

import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";
import {
  videoGenerationJobRepository,
  renderTaskRepository,
} from "@/repositories/index";
import { pool } from "@/lib/db";
import { VideoGenerationService } from "@/services/VideoGenerationService";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { AI_CONFIG } from "@/config/aiTools";
import type { RenderTask } from "@/domain/models/RenderTask";

const RUN_ONCE = process.argv.includes("--once");
const WORKER_ID = `${os.hostname()}#${process.pid}`;
const SCRATCH_ROOT = AI_CONFIG.ffmpeg.tmpDir || path.join(os.tmpdir(), "clipper");

const service = new VideoGenerationService();

let shuttingDown = false;
let active = 0;
/** taskIds currently being processed — kept alive by the heartbeat loop. */
const inFlight = new Set<string>();

function log(msg: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  console.log(`[worker ${WORKER_ID}] ${ts} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`);
}

/**
 * Expand an error into loggable detail. `String(err)` collapses everything to
 * "Name: message" (e.g. "Unknown: UnknownError"), hiding the stack, the wrapped
 * `cause`, an ffmpeg subprocess's `stderr`, and AWS SDK `$metadata`/`code` — all
 * of which are usually what actually identifies the failure.
 */
function describeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const e = err as Error & {
      cause?: unknown; code?: unknown; $metadata?: unknown; stderr?: unknown; cmd?: unknown;
    };
    return {
      name: e.name,
      message: e.message,
      code: e.code,
      cmd: e.cmd,
      stderr: typeof e.stderr === "string" ? e.stderr.split("\n").slice(-6).join(" | ") : e.stderr,
      awsMetadata: e.$metadata,
      cause: e.cause instanceof Error ? { name: e.cause.name, message: e.cause.message } : e.cause ? String(e.cause) : undefined,
      stack: e.stack,
    };
  }
  return { raw: String(err) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Release every in-flight claim back to the queue (state → "queued") so a
 * restarting worker re-claims it IMMEDIATELY instead of waiting out
 * RENDER_STALE_CLAIM_SECONDS. Safe because every heavy step is idempotent
 * (compose/additional-ratios skip ratios already persisted), so redoing a
 * partially-done step produces no duplicate/partial artifacts. FIFO position is
 * preserved — release keeps the original enqueued_at.
 */
async function releaseInFlightClaims(): Promise<void> {
  await Promise.all(
    [...inFlight].map((taskId) => renderTaskRepository.release(taskId).catch(() => {}))
  );
}

/**
 * Resource sampling (migration 028, `render_worker_samples`).
 *
 * `render_worker_heartbeat` keeps only ONE `last_seen_at` per worker, so it
 * answers "is the Mac alive" and nothing else — there was no history to size CPU
 * against. One sample a minute is enough resolution for that question and keeps
 * the table at ~1,440 rows/day/worker (the migration documents the 180-day prune).
 *
 * Every 6th heartbeat tick rather than its own timer: the heartbeat already runs
 * on the right cadence (10s), and a second interval would drift against it and
 * add a second thing to tear down at shutdown.
 */
const TICKS_PER_SAMPLE = Math.max(
  1,
  Math.round(60_000 / RENDER_QUEUE.heartbeatIntervalMs)
);
let heartbeatTicks = 0;

/**
 * `process.cpuUsage()` is a monotonic total since process start, so a single
 * reading says nothing about current load. Keep the previous reading and report
 * the delta over the elapsed wall time, divided by the core count — 100% means
 * every core saturated, which is the number that matters when deciding whether
 * the Mac needs more cores.
 */
let lastCpuUsage = process.cpuUsage();
let lastCpuSampleAt = Date.now();

function cpuPercentSinceLastSample(): number | null {
  const now = Date.now();
  const elapsedMs = now - lastCpuSampleAt;
  const usage = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  lastCpuSampleAt = now;
  if (elapsedMs <= 0) return null;
  const cores = os.cpus().length || 1;
  const usedMs = (usage.user + usage.system) / 1000;
  return Math.round((usedMs / (elapsedMs * cores)) * 1000) / 10;
}

/**
 * Write one resource sample. Never throws and never awaits anything a render
 * depends on — an analytics outage must not stall or kill the worker.
 */
async function recordResourceSample(): Promise<void> {
  try {
    const cpuPercent = cpuPercentSinceLastSample();
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

    // Platform-wide backlog, not this worker's: the point of pairing it with the
    // load numbers is to see whether a busy Mac is keeping up with the line.
    // COUNT(*) comes back from `pg` as a STRING — cast in SQL, not in JS.
    let queueDepth: number | null = null;
    const { rows } = await pool.query(
      `SELECT count(*)::int AS depth FROM render_tasks WHERE state IN ('queued','claimed')`
    );
    if (rows[0]) queueDepth = rows[0].depth as number;

    await pool.query(
      `INSERT INTO render_worker_samples
         (worker_id, cpu_percent, load_avg_1m, cpu_count,
          mem_used_mb, mem_total_mb, active_tasks, queue_depth)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        WORKER_ID,
        cpuPercent,
        os.loadavg()[0],
        os.cpus().length,
        mb(totalBytes - freeBytes),
        mb(totalBytes),
        inFlight.size,
        queueDepth,
      ]
    );
  } catch (err) {
    log("resource sample failed", { error: String(err) });
  }
}

/**
 * Heartbeat loop: advertise liveness (so the web side enqueues instead of
 * running inline) and bump the keep-alive on every in-flight claim (so a long
 * render is not reclaimed as stale by another worker).
 */
async function heartbeatTick(): Promise<void> {
  try {
    await videoGenerationJobRepository.recordWorkerHeartbeat(WORKER_ID);
    await Promise.all(
      [...inFlight].map((taskId) => renderTaskRepository.touch(taskId).catch(() => {}))
    );
  } catch (err) {
    log("heartbeat failed", { error: String(err) });
  }

  // Outside the try above so a heartbeat failure does not skip the sample (and,
  // more importantly, so a sampling failure can never be mistaken for a lost
  // heartbeat, which is what the web side's inline-vs-enqueue decision reads).
  heartbeatTicks += 1;
  if (heartbeatTicks % TICKS_PER_SAMPLE === 0) {
    await recordResourceSample();
  }
}

/** Remove any stale per-job scratch dirs left by a previously killed process. */
async function sweepScratch(): Promise<void> {
  try {
    await fs.mkdir(SCRATCH_ROOT, { recursive: true });
    const entries = await fs.readdir(SCRATCH_ROOT).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((e) => e.startsWith("job-"))
        .map((e) => fs.rm(path.join(SCRATCH_ROOT, e), { recursive: true, force: true }).catch(() => {}))
    );
  } catch {
    /* best-effort */
  }
}

async function processTask(task: RenderTask): Promise<void> {
  active += 1;
  inFlight.add(task.id);
  const scratch = path.join(SCRATCH_ROOT, `job-${task.jobId}`);
  const startedAt = Date.now();
  // Log which STEP and which USER this worker is processing (requesterId is the
  // requesting user's id, denormalised onto the task — never shown to other
  // requesters, who only ever see a position count).
  log("claimed step", {
    task: task.id,
    step: task.step,
    user: task.requesterId,
    request: task.requestId,
    job: task.jobId,
  });
  try {
    const job = await videoGenerationJobRepository.findById(task.jobId);
    if (!job) throw new Error(`Job not found for render task: ${task.jobId}`);

    await fs.mkdir(scratch, { recursive: true });
    // The compute reused from VideoGenerationService streams its own inputs from
    // Spaces and uploads outputs back, so pull/render/push all happen inside this
    // call. We time the whole step; transfer is a small fraction of compute (see
    // docs/storage-lifecycle-design.md Addendum B).
    await service.runQueuedRenderStep(job, task.step, task.payload);
    await renderTaskRepository.complete(task.id, "done");
    log("step done", {
      task: task.id,
      step: task.step,
      user: task.requesterId,
      seconds: sec(startedAt),
    });
    // Only NOW may the next step be enqueued: a job holds at most one active
    // render task, so an enqueue before `complete` above would have replaced
    // this very row and the "done" would have landed on the unrun next step.
    // Used by the step-5 "approve everything from here" express lane; a no-op
    // for every other job. Never throws.
    await service.afterRenderStepCompleted(task.jobId);
  } catch (err) {
    // Shutdown, not breakage. launchd signals the whole job, so a SIGTERM also
    // reaches the render's CHILD processes — Remotion's compositor and ffmpeg die
    // instantly and surface here as "Compositor quit with signal SIGTERM". Marking
    // that as a real failure would push a requester's job to Failed because an
    // operator restarted the worker, and it would beat the drain-grace release in
    // main() to the punch (the step "finished", so allSlotsDone resolves and
    // releaseInFlightClaims never runs — the release path could never fire for a
    // render, since being signalled is exactly what makes it exit early).
    //
    // Release the claim instead: state goes back to 'queued' with its original
    // enqueued_at, so the restarted worker re-claims it and the job keeps sitting
    // on its processing step, which is the truth. Every heavy step is safe to
    // redo — compose and additional-ratios skip units already persisted; overlay
    // and merge recompute a single output and overwrite it. (Scene rendering
    // redoes the whole batch from scene 1: correct, just slower.)
    if (shuttingDown) {
      log("step INTERRUPTED by shutdown — releasing claim for reclaim", {
        task: task.id,
        step: task.step,
        user: task.requesterId,
        seconds: sec(startedAt),
      });
      await renderTaskRepository.release(task.id).catch(() => {});
      return;
    }

    log("step FAILED", {
      task: task.id,
      step: task.step,
      user: task.requesterId,
      seconds: sec(startedAt),
      ...describeErr(err),
    });
    const message = err instanceof Error ? err.message : String(err);
    await renderTaskRepository.complete(task.id, "failed", message).catch(() => {});
    // Mirror the inline `.catch`: mark the pipeline failed at the right step so
    // the UI shows the error and retryPipeline can resume from it.
    const job = await videoGenerationJobRepository.findById(task.jobId).catch(() => null);
    if (job) await service.recordRenderStepFailure(job, task.step).catch(() => {});
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    inFlight.delete(task.id);
    active -= 1;
  }
}

function sec(sinceMs: number): number {
  return Math.round((Date.now() - sinceMs) / 100) / 10;
}

/** One worker slot: claim → run → repeat; idle-sleep when the line is empty. */
async function workerSlot(slot: number): Promise<void> {
  while (!shuttingDown) {
    let task: RenderTask | null = null;
    try {
      task = await renderTaskRepository.claimNext(
        WORKER_ID,
        RENDER_QUEUE.staleClaimSeconds
      );
    } catch (err) {
      log("claim query failed", { slot, error: String(err) });
      if (RUN_ONCE) return;
      await sleep(RENDER_QUEUE.pollIntervalMs);
      continue;
    }
    if (!task) {
      if (RUN_ONCE) return;
      await sleep(RENDER_QUEUE.pollIntervalMs);
      continue;
    }
    await processTask(task);
    if (RUN_ONCE) return;
  }
}

async function main(): Promise<void> {
  log("starting", {
    concurrency: RENDER_QUEUE.concurrency,
    pollMs: RENDER_QUEUE.pollIntervalMs,
    heartbeatMs: RENDER_QUEUE.heartbeatIntervalMs,
    staleClaimSeconds: RENDER_QUEUE.staleClaimSeconds,
    scratch: SCRATCH_ROOT,
    once: RUN_ONCE,
  });

  // Advertise liveness IMMEDIATELY — before the scratch sweep and the first poll —
  // so the web app's isRenderWorkerAlive() sees a fresh heartbeat the instant we're
  // back and ENQUEUES heavy steps to us instead of running them inline on the
  // droplet. RENDER_WORKER_FRESH_SECONDS (45s) comfortably exceeds heartbeatMs (10s),
  // so a normal restart never opens an "offline" gap unless it takes >45s.
  await heartbeatTick();
  const heartbeat = setInterval(heartbeatTick, RENDER_QUEUE.heartbeatIntervalMs);
  await sweepScratch();

  let onShutdown: () => void = () => {};
  const shutdownRequested = new Promise<void>((resolve) => {
    onShutdown = resolve;
  });
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, draining ${active} in-flight step(s)…`);
    onShutdown();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const slots = Array.from({ length: RENDER_QUEUE.concurrency }, (_, i) => workerSlot(i));
  const allSlotsDone = Promise.all(slots);

  if (RUN_ONCE) {
    await allSlotsDone;
  } else {
    // Run until a shutdown signal arrives. On shutdown, workerSlot stops claiming
    // new work and its current step finishes naturally — but bound how long we wait
    // so launchd doesn't SIGKILL us mid-exit. If the in-flight step can't finish
    // within the grace window, release its claim so the restarted worker re-claims
    // it immediately (idempotent steps make the redo safe).
    await shutdownRequested;
    const drained = await Promise.race([
      allSlotsDone.then(() => true),
      sleep(RENDER_QUEUE.drainGraceMs).then(() => false),
    ]);
    if (!drained) {
      log(`drain grace ${RENDER_QUEUE.drainGraceMs}ms elapsed with ${active} step(s) still running — releasing claim(s) for immediate reclaim`);
      await releaseInFlightClaims();
    }
  }

  clearInterval(heartbeat);
  log("stopped");
  process.exit(0);
}

main().catch((err) => {
  log("fatal", { error: String(err) });
  process.exit(1);
});
