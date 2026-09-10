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

  /**
   * Ageing: points a waiting task gains per whole hour in the line.
   *
   * Without ageing, strict priority starves free work forever under sustained
   * paid load — free requesters churn and the trial ladder stops acquiring
   * anyone. With it, a task that has waited long enough eventually outranks
   * freshly-paid work, so every job finishes.
   */
  agingPointsPerHour: Number(process.env.RENDER_AGING_POINTS_PER_HOUR ?? "10"),

  /**
   * Maximum ageing bonus, in points. At the default 10 points/hour this is
   * reached after ~12 hours, at which point an unpaid task outranks any
   * just-enqueued paid one. Capping it keeps the bonus from growing without
   * bound and inverting the policy entirely.
   */
  agingCapPoints: Number(process.env.RENDER_AGING_CAP_POINTS ?? "120"),
};

/**
 * Base priority by which allowance a request was drawn from.
 *
 * WHY THIS EXISTS. One render costs 2–3 hours on a single worker
 * (`concurrency` is 1 by default), so the line is the scarcest resource in the
 * product — scarcer than money. A paying subscriber's 10 monthly requests are
 * served ahead of the free allowance; free work runs on what is left.
 *
 * These are the BASE values only — {@link effectiveRenderPriority} adds the
 * ageing bonus, so a low base never means "never". With paid work always ahead,
 * that bonus is the ONLY thing keeping free requests from starving under load.
 */
export const RENDER_PRIORITY = {
  /** Drawn from a purchased monthly allowance window. */
  paid: 100,
  /** Drawn from the free allowance (3 per rolling 30 days). */
  free: 0,
} as const;

/**
 * The base priority for a request, from the allowance it was drawn against.
 *
 * Deliberately shaped around the field rather than importing the tier enum, so
 * this stays a pure policy function with no domain dependency.
 */
export function renderPriorityForRequest(request: {
  pricingTier?: string | null;
}): number {
  if (request.pricingTier === "free") return RENDER_PRIORITY.free;
  // Unknown/legacy rows: treat as paid. A paid request wrongly demoted is a
  // customer kept waiting; a free one wrongly promoted costs only ordering.
  return RENDER_PRIORITY.paid;
}

/**
 * A task's priority including its ageing bonus — the number the line is actually
 * ordered by. Whole hours only, so the ordering is stable between polls instead
 * of churning every second.
 *
 * The Postgres repository computes this same expression in SQL (it must order in
 * the database to claim atomically); the mock repository calls this directly.
 * Keep the two in step — a divergence shows up as a queue position that
 * disagrees with what actually renders next.
 */
export function effectiveRenderPriority(
  priority: number,
  enqueuedAt: Date,
  now: Date = new Date()
): number {
  const hoursWaited = Math.max(
    0,
    Math.floor((now.getTime() - enqueuedAt.getTime()) / 3_600_000)
  );
  const bonus = Math.min(
    RENDER_QUEUE.agingCapPoints,
    hoursWaited * RENDER_QUEUE.agingPointsPerHour
  );
  return priority + bonus;
}

/**
 * Sort comparator for the active line: negative when `a` should be claimed
 * before `b`. Highest effective priority first, then oldest first — so tasks at
 * equal priority keep plain FIFO order.
 */
export function compareRenderOrder(
  a: { priority: number; enqueuedAt: Date },
  b: { priority: number; enqueuedAt: Date },
  now: Date = new Date()
): number {
  const byPriority =
    effectiveRenderPriority(b.priority, b.enqueuedAt, now) -
    effectiveRenderPriority(a.priority, a.enqueuedAt, now);
  if (byPriority !== 0) return byPriority;
  return a.enqueuedAt.getTime() - b.enqueuedAt.getTime();
}

/** Terminal render-state values (a claim is finished). */
export type RenderState = "queued" | "claimed" | "done" | "failed";
