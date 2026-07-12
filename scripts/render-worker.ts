/**
 * RClipper render worker — Mac Mini processing unit.
 *
 * Long-running, OUTBOUND-ONLY process. It polls managed Postgres for queued
 * heavy pipeline steps (montage render, animation/overlay render, FFmpeg
 * composition, additional-ratios), runs each by reusing the EXISTING compute in
 * VideoGenerationService (which streams its own inputs from DO Spaces and pushes
 * outputs back with ACL:"public-read" unchanged), then marks the job done. No
 * inbound port, static IP, or tunnel is needed.
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
import { videoGenerationJobRepository } from "@/repositories/index";
import { VideoGenerationService } from "@/services/VideoGenerationService";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { AI_CONFIG } from "@/config/aiTools";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";

const RUN_ONCE = process.argv.includes("--once");
const WORKER_ID = `${os.hostname()}#${process.pid}`;
const SCRATCH_ROOT = AI_CONFIG.ffmpeg.tmpDir || path.join(os.tmpdir(), "clipper");

const service = new VideoGenerationService();

let shuttingDown = false;
let active = 0;
/** jobIds currently being processed — kept alive by the heartbeat loop. */
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
 * Release every in-flight claim back to the queue (render_state → "queued") so a
 * restarting worker re-claims it IMMEDIATELY instead of waiting out
 * RENDER_STALE_CLAIM_SECONDS. Safe because every heavy step is idempotent
 * (compose/additional-ratios skip ratios already persisted), so redoing a
 * partially-done step produces no duplicate/partial artifacts.
 */
async function releaseInFlightClaims(): Promise<void> {
  await Promise.all(
    [...inFlight].map((jobId) =>
      videoGenerationJobRepository
        .update(jobId, {
          renderState: "queued",
          claimedBy: null,
          claimedAt: null,
          renderHeartbeatAt: null,
        })
        .catch(() => {})
    )
  );
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
      [...inFlight].map((jobId) =>
        videoGenerationJobRepository.touchRenderClaim(jobId).catch(() => {})
      )
    );
  } catch (err) {
    log("heartbeat failed", { error: String(err) });
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

async function processJob(job: VideoGenerationJob): Promise<void> {
  active += 1;
  inFlight.add(job.id);
  const scratch = path.join(SCRATCH_ROOT, `job-${job.id}`);
  const startedAt = Date.now();
  log("claimed step", { job: job.id, step: job.renderStep, request: job.requestId });
  try {
    await fs.mkdir(scratch, { recursive: true });
    // The compute reused from VideoGenerationService streams its own inputs from
    // Spaces and uploads outputs back, so pull/render/push all happen inside this
    // call. We time the whole step; transfer is a small fraction of compute (see
    // docs/storage-lifecycle-design.md Addendum B).
    await service.runQueuedRenderStep(job);
    await videoGenerationJobRepository.completeRenderClaim(job.id, "done");
    log("step done", { job: job.id, step: job.renderStep, seconds: sec(startedAt) });
  } catch (err) {
    log("step FAILED", { job: job.id, step: job.renderStep, seconds: sec(startedAt), ...describeErr(err) });
    await videoGenerationJobRepository.completeRenderClaim(job.id, "failed").catch(() => {});
    // Mirror the inline `.catch`: mark the pipeline failed at the right step so
    // the UI shows the error and retryPipeline can resume from it.
    await service.recordRenderStepFailure(job).catch(() => {});
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    inFlight.delete(job.id);
    active -= 1;
  }
}

function sec(sinceMs: number): number {
  return Math.round((Date.now() - sinceMs) / 100) / 10;
}

/** One worker slot: claim → run → repeat; idle-sleep when the queue is empty. */
async function workerSlot(slot: number): Promise<void> {
  while (!shuttingDown) {
    let job: VideoGenerationJob | null = null;
    try {
      job = await videoGenerationJobRepository.claimNextQueuedRenderStep(
        WORKER_ID,
        RENDER_QUEUE.staleClaimSeconds
      );
    } catch (err) {
      log("claim query failed", { slot, error: String(err) });
      if (RUN_ONCE) return;
      await sleep(RENDER_QUEUE.pollIntervalMs);
      continue;
    }
    if (!job) {
      if (RUN_ONCE) return;
      await sleep(RENDER_QUEUE.pollIntervalMs);
      continue;
    }
    await processJob(job);
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
