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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    log("step FAILED", { job: job.id, step: job.renderStep, seconds: sec(startedAt), error: String(err) });
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

  await sweepScratch();
  await heartbeatTick(); // advertise liveness immediately so the web side enqueues
  const heartbeat = setInterval(heartbeatTick, RENDER_QUEUE.heartbeatIntervalMs);

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, draining ${active} in-flight step(s)…`);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const slots = Array.from({ length: RENDER_QUEUE.concurrency }, (_, i) => workerSlot(i));
  await Promise.all(slots);

  clearInterval(heartbeat);
  // Wait for any straggler to finish its finally block before exiting.
  while (active > 0) await sleep(200);
  log("stopped");
  process.exit(0);
}

main().catch((err) => {
  log("fatal", { error: String(err) });
  process.exit(1);
});
