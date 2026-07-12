/**
 * Configuration for the render-queue seam (Mac Mini worker offload).
 *
 * All values are safe defaults tuned so that, with NO worker present, behaviour
 * is identical to running every heavy step inline on the web server.
 */
export const RENDER_QUEUE = {
  /**
   * Master switch. When false, heavy steps always run inline (the seam is a
   * no-op). Default on; a worker still has to be alive for anything to enqueue.
   * Set RENDER_QUEUE_ENABLED=false to force inline everywhere.
   */
  enabled: process.env.RENDER_QUEUE_ENABLED !== "false",

  /**
   * A worker heartbeat newer than this many seconds means "a worker is alive,
   * enqueue for it". Older/absent → the web server runs the step itself
   * (fallback), so the droplet is never blocked when the Mac is offline.
   */
  workerFreshSeconds: Number(process.env.RENDER_WORKER_FRESH_SECONDS ?? "45"),

  /**
   * A claim whose keep-alive (render_heartbeat_at, else claimed_at) is older
   * than this is considered abandoned (crashed worker) and may be re-claimed.
   * A live render bumps render_heartbeat_at every heartbeatIntervalMs (10s), so
   * only a genuinely dead worker's claim goes stale. Kept low (2 min) so a job
   * abandoned by a SIGKILL'd worker is picked back up quickly rather than sitting
   * idle for the old 10-minute window. The graceful-shutdown path releases claims
   * immediately (see the worker's drain), so this is only the crash backstop.
   */
  staleClaimSeconds: Number(process.env.RENDER_STALE_CLAIM_SECONDS ?? "120"),

  /** Worker: how often to bump its heartbeat / claim keep-alive, in ms. */
  heartbeatIntervalMs: Number(process.env.RENDER_HEARTBEAT_INTERVAL_MS ?? "10000"),

  /**
   * Worker: on SIGTERM, how long to let an in-flight step finish before releasing
   * its claim and exiting. Kept under launchd's SIGKILL timeout so the worker exits
   * cleanly; a step that can't finish in time is requeued (idempotent) for the
   * restarted worker rather than abandoned to the stale-claim window.
   */
  drainGraceMs: Number(process.env.RENDER_DRAIN_GRACE_MS ?? "15000"),

  /** Worker: how often to poll for a queued step when idle, in ms. */
  pollIntervalMs: Number(process.env.RENDER_POLL_INTERVAL_MS ?? "3000"),

  /** Worker: max heavy steps processed concurrently (1–2 on a 16 GB M4). */
  concurrency: Math.max(1, Number(process.env.RENDER_CONCURRENCY ?? "1")),
};

/** Terminal render-state values (a claim is finished). */
export type RenderState = "queued" | "claimed" | "done" | "failed";
