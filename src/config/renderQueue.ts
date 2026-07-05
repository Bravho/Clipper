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
   */
  staleClaimSeconds: Number(process.env.RENDER_STALE_CLAIM_SECONDS ?? "600"),

  /** Worker: how often to bump its heartbeat / claim keep-alive, in ms. */
  heartbeatIntervalMs: Number(process.env.RENDER_HEARTBEAT_INTERVAL_MS ?? "10000"),

  /** Worker: how often to poll for a queued step when idle, in ms. */
  pollIntervalMs: Number(process.env.RENDER_POLL_INTERVAL_MS ?? "3000"),

  /** Worker: max heavy steps processed concurrently (1–2 on a 16 GB M4). */
  concurrency: Math.max(1, Number(process.env.RENDER_CONCURRENCY ?? "1")),
};

/** Terminal render-state values (a claim is finished). */
export type RenderState = "queued" | "claimed" | "done" | "failed";
