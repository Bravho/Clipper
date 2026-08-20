import { pool } from "@/lib/db";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { PROCESSING_STEP_TIMEOUT_SECONDS } from "@/config/stallThresholds";
import { RENDER_STEP_FAILED_AT, RenderStep } from "@/domain/enums/RenderStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { RenderQueueSnapshot } from "@/services/admin/AdminDashboardService";

/**
 * Timing profile of the generation pipeline: how long a step WAITS before it is
 * picked up, and how long it then TAKES.
 *
 * The two numbers answer different questions and must never be added together.
 * A step that is slow because the single Mac Mini worker is busy is fixed by
 * capacity; a step that is slow because it is expensive is fixed by the render
 * itself. The page therefore always shows wait and run side by side.
 *
 * NO REPOSITORY ON PURPOSE — these are aggregate reads over `render_tasks` and
 * `video_generation_step_history` producing no domain model, and the percentile
 * work belongs in Postgres. The pool is constructor-injected (the
 * `ManagementAuditService` / `LoginEventService` pattern) so the tests can drive
 * a stub instead of opening a socket.
 *
 * KNOWN HOLES IN THIS DATA, all surfaced on the page rather than hidden here:
 *   1. `enqueue()` upserts with `ON CONFLICT ... DO UPDATE`, which resets
 *      `enqueued_at`, `attempts` and `duration_ms`. Section A therefore
 *      describes the LAST attempt of each step, not every attempt.
 *   2. `release()` preserves `enqueued_at`, so an interrupted step's "wait"
 *      spans the interruption and reads as queue pressure that never happened.
 *   3. When no worker is alive, `_dispatchHeavy()` runs the step inline on the
 *      web server and writes NO `render_tasks` row at all. Those runs are
 *      invisible to section A entirely — section D counts them.
 */

/**
 * Which `RenderStep`s can be behind a given pipeline step.
 *
 * Derived by inverting `RENDER_STEP_FAILED_AT` rather than restating the
 * mapping: that table already encodes "if this render step throws, the job
 * failed at this pipeline step", which is the same correspondence. Travy is
 * excluded — its entry there is a placeholder for type completeness (the step
 * is soft-failing and never fails the pipeline), and it runs during
 * `awaiting_distribution_review` rather than being a pipeline step of its own,
 * so treating it as one would report every finished job as an inline fallback.
 */
export const PIPELINE_STEP_RENDER_STEPS: Partial<
  Record<VideoGenerationStep, RenderStep[]>
> = (() => {
  const map: Partial<Record<VideoGenerationStep, RenderStep[]>> = {};
  for (const [renderStep, pipelineStep] of Object.entries(RENDER_STEP_FAILED_AT) as [
    RenderStep,
    VideoGenerationStep,
  ][]) {
    if (renderStep === RenderStep.TravyGeneration) continue;
    (map[pipelineStep] ??= []).push(renderStep);
  }
  return map;
})();

/** The pipeline steps that are supposed to reach the render queue. */
export const QUEUE_BACKED_PIPELINE_STEPS = Object.keys(
  PIPELINE_STEP_RENDER_STEPS
) as VideoGenerationStep[];

/** A wait/run distribution. All values are milliseconds; null means no sample. */
export interface DurationStats {
  mean: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
}

/** Section A: one row per `render_tasks.step`. */
export interface RenderStepStats {
  step: string;
  /** Tasks in range (by `enqueued_at`). */
  total: number;
  /** Tasks that were actually claimed — the denominator for the wait stats. */
  claimed: number;
  /** Tasks that finished with a duration — the denominator for the run stats. */
  finished: number;
  failed: number;
  /** 0–100. */
  failureRatePct: number;
  avgAttempts: number;
  wait: DurationStats;
  run: DurationStats;
}

/** Section B: one row per `video_generation_step_history.step`. */
export interface PipelineStepStats {
  step: string;
  /** True for the `awaiting_*` review gates — user thinking time, not compute. */
  isGate: boolean;
  samples: number;
  dwell: DurationStats;
}

/** Section D: render-step transitions with no queue row behind them. */
export interface InlineFallbackRow {
  step: string;
  /** De-duplicated transitions into this step in range. */
  transitions: number;
  /** Of those, the ones whose job has no `render_tasks` row for the step. */
  inline: number;
}

export interface InlineFallbackReport {
  rows: InlineFallbackRow[];
  totalTransitions: number;
  totalInline: number;
  /** 0–100. */
  inlineSharePct: number;
}

/** Section E: a job sitting on a processing step past its threshold. */
export interface StalledJob {
  jobId: string;
  requestId: string;
  requestTitle: string | null;
  step: string;
  /** How long it has been on that step, in milliseconds. */
  stalledForMs: number;
  /** The threshold it exceeded, in milliseconds. */
  thresholdMs: number;
  /**
   * True when a worker is actively holding this job's task with a fresh
   * keep-alive — a long render in progress, not an abandoned one.
   */
  workerActive: boolean;
}

/** Section C: the live queue, reduced to the three numbers the page shows. */
export interface QueueSummary {
  workerOnline: boolean;
  queued: number;
  claimed: number;
  /** Wait of the oldest still-unclaimed task, in milliseconds. */
  oldestWaitingMs: number | null;
  oldestWaitingStep: string | null;
}

/**
 * Minimal shape of the `pg` pool this service needs, so tests can inject a stub
 * without constructing a real Pool.
 */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** `pg` returns COUNT/NUMERIC/BIGINT as STRINGS. Parse at the boundary. */
function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** Same, but keeps the fraction and preserves "no sample" as null. */
function toFloatOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toFloat(value: unknown): number {
  return toFloatOrNull(value) ?? 0;
}

function readStats(row: Record<string, unknown>, prefix: string): DurationStats {
  return {
    mean: toFloatOrNull(row[`${prefix}_mean`]),
    median: toFloatOrNull(row[`${prefix}_p50`]),
    p90: toFloatOrNull(row[`${prefix}_p90`]),
    max: toFloatOrNull(row[`${prefix}_max`]),
  };
}

/**
 * Milliseconds as something a human reads at a glance.
 *
 * Raw milliseconds are unreadable at pipeline scale — `967431` and `9674310`
 * look identical in a table column, and one is sixteen minutes.
 *
 * The implementation lives in `@/features/admin/formatDuration`, which imports
 * nothing server-side, so the client chart components can share it without
 * pulling the `pg` pool into the browser bundle. Re-exported here because the
 * pages already import it from this module.
 */
export { formatDuration } from "@/features/admin/formatDuration";

/**
 * Section A. Queue wait and run time per render step.
 *
 * Wait is `claimed_at - enqueued_at`, run is the recorded `duration_ms` — never
 * `finished_at - started_at`, which would also count the worker's own bookkeeping.
 * `percentile_cont` skips NULL inputs, so unclaimed and unfinished tasks drop out
 * of the distributions on their own; the explicit counts beside them are what
 * tell a reader how much of the population each distribution actually covers.
 */
const RENDER_STEP_STATS_SQL = `
  SELECT
    rt.step                                                       AS step,
    COUNT(*)::int                                                 AS total,
    COUNT(rt.claimed_at)::int                                     AS claimed,
    COUNT(rt.duration_ms)::int                                    AS finished,
    COUNT(*) FILTER (WHERE rt.state = 'failed')::int              AS failed,
    COALESCE(AVG(rt.attempts), 0)::float8                         AS avg_attempts,
    AVG(EXTRACT(EPOCH FROM (rt.claimed_at - rt.enqueued_at)) * 1000)::float8 AS wait_mean,
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (rt.claimed_at - rt.enqueued_at)) * 1000
    )::float8                                                     AS wait_p50,
    percentile_cont(0.9) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (rt.claimed_at - rt.enqueued_at)) * 1000
    )::float8                                                     AS wait_p90,
    MAX(EXTRACT(EPOCH FROM (rt.claimed_at - rt.enqueued_at)) * 1000)::float8 AS wait_max,
    AVG(rt.duration_ms)::float8                                   AS run_mean,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY rt.duration_ms)::float8 AS run_p50,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY rt.duration_ms)::float8 AS run_p90,
    MAX(rt.duration_ms)::float8                                   AS run_max
  FROM render_tasks rt
  WHERE rt.enqueued_at >= $1
    AND rt.enqueued_at < $2
  GROUP BY rt.step
  ORDER BY rt.step`;

/**
 * Section B. Dwell time per pipeline step, from the append-only step history.
 *
 * This is the ONLY way to time `analyzing_content`, `generating_voice` and
 * `generating_scene_design`: they call out to ChatGPT / iAppTTS / Gemini inline
 * on the web server and never touch the render queue, so `render_tasks` knows
 * nothing about them.
 *
 * THE DE-DUP IS LOAD-BEARING. The history write guard is
 * `currentStep !== undefined`, not "the value changed", so any update that
 * carries the current step appends another identical row. Running `LEAD` over
 * the raw rows would measure the gap between two writes of the SAME step —
 * usually milliseconds — and report every step as instant while the real
 * duration silently attaches to the last repeat. Collapsing consecutive
 * duplicates with `LAG(step) IS DISTINCT FROM step` BEFORE the `LEAD` is what
 * makes the number a step duration instead of a write interval.
 *
 * `id` is the `ORDER BY` tiebreaker: two rows can share a timestamp at
 * millisecond resolution, and without a stable second key the de-dup would
 * depend on scan order.
 *
 * The scan covers the FULL history of every job that appears in range, not just
 * the in-range rows: `LEAD` needs the row AFTER the last one in the window, or
 * the final step of every job in range would look open-ended and be dropped.
 */
const PIPELINE_STEP_STATS_SQL = `
  WITH scoped AS (
    SELECT h.id, h.job_id, h.step, h.created_at
      FROM video_generation_step_history h
     WHERE h.job_id IN (
             SELECT DISTINCT j.job_id
               FROM video_generation_step_history j
              WHERE j.created_at >= $1 AND j.created_at < $2
           )
  ),
  deduped AS (
    SELECT job_id, step, created_at
      FROM (
        SELECT s.job_id, s.step, s.created_at,
               LAG(s.step) OVER (PARTITION BY s.job_id ORDER BY s.created_at, s.id) AS prev_step
          FROM scoped s
      ) marked
     WHERE prev_step IS DISTINCT FROM step
  ),
  spans AS (
    SELECT d.step,
           d.created_at,
           EXTRACT(EPOCH FROM (
             LEAD(d.created_at) OVER (PARTITION BY d.job_id ORDER BY d.created_at) - d.created_at
           )) * 1000 AS dwell_ms
      FROM deduped d
  )
  SELECT step                                                      AS step,
         COUNT(*)::int                                             AS samples,
         AVG(dwell_ms)::float8                                     AS dwell_mean,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY dwell_ms)::float8 AS dwell_p50,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY dwell_ms)::float8 AS dwell_p90,
         MAX(dwell_ms)::float8                                     AS dwell_max
    FROM spans
   WHERE dwell_ms IS NOT NULL
     AND created_at >= $1
     AND created_at < $2
   GROUP BY step
   ORDER BY step`;

/**
 * Section D. Render-step transitions that never produced a queue row.
 *
 * Same de-dup as section B, for the same reason. The existence test is
 * deliberately loose — "did this job EVER enqueue this step" — because
 * `enqueued_at` is reset by the upsert and cannot be matched to a specific
 * transition. That makes the result a LOWER BOUND: a job that ran the step on
 * the worker once and inline once counts as fully queued. It is the
 * conservative direction, which matters for a number whose whole purpose is to
 * say "the timings above are missing at least this much work".
 *
 * `job_id` is TEXT in both tables, but `video_generation_jobs.id` is uuid in
 * some environments (migration 005 says so), so both sides are cast to text.
 */
const INLINE_FALLBACK_SQL = `
  WITH step_map AS (
    SELECT * FROM unnest($3::text[], $4::text[]) AS m(pipeline_step, render_step)
  ),
  scoped AS (
    SELECT h.id, h.job_id, h.step, h.created_at
      FROM video_generation_step_history h
     WHERE h.job_id IN (
             SELECT DISTINCT j.job_id
               FROM video_generation_step_history j
              WHERE j.created_at >= $1 AND j.created_at < $2
           )
  ),
  deduped AS (
    SELECT job_id, step, created_at
      FROM (
        SELECT s.job_id, s.step, s.created_at,
               LAG(s.step) OVER (PARTITION BY s.job_id ORDER BY s.created_at, s.id) AS prev_step
          FROM scoped s
      ) marked
     WHERE prev_step IS DISTINCT FROM step
  )
  SELECT d.step                                     AS step,
         COUNT(*)::int                              AS transitions,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1
             FROM render_tasks rt
             JOIN step_map m ON m.render_step = rt.step
            WHERE rt.job_id::text = d.job_id::text
              AND m.pipeline_step = d.step
         ))::int                                    AS inline
    FROM deduped d
   WHERE d.created_at >= $1
     AND d.created_at < $2
     AND d.step = ANY($3::text[])
   GROUP BY d.step
   ORDER BY d.step`;

/**
 * Section E. Jobs past their per-step threshold.
 *
 * Thresholds come from `PROCESSING_STEP_TIMEOUT_SECONDS` and are passed in as
 * parallel arrays rather than written into the SQL, so the numbers live in one
 * place — the config already explains why compose gets 25 minutes and the rest
 * do not, and a copy here would drift from it.
 *
 * `workerActive` mirrors `isJobStalled`'s carve-out: a job whose task is held by
 * a worker with a fresh keep-alive is rendering, not stuck. It is reported as a
 * column rather than filtered out, because on this page "long but alive" is
 * itself the interesting case.
 */
const STALL_WATCH_SQL = `
  WITH thresholds AS (
    SELECT * FROM unnest($1::text[], $2::int[]) AS t(step, timeout_seconds)
  )
  SELECT j.id                                                          AS job_id,
         j.request_id                                                  AS request_id,
         cr.title                                                      AS request_title,
         j.current_step                                                AS step,
         EXTRACT(EPOCH FROM (NOW() - j.step_started_at)) * 1000        AS stalled_for_ms,
         t.timeout_seconds * 1000                                      AS threshold_ms,
         EXISTS (
           SELECT 1
             FROM render_tasks rt
            WHERE rt.job_id::text = j.id::text
              AND rt.state IN ('queued', 'claimed')
              AND COALESCE(rt.heartbeat_at, rt.claimed_at) > NOW() - make_interval(secs => $4::int)
         )                                                             AS worker_active
    FROM video_generation_jobs j
    JOIN thresholds t ON t.step = j.current_step
    LEFT JOIN clip_requests cr ON cr.id::text = j.request_id::text
   WHERE j.status = $3
     AND j.step_started_at < NOW() - make_interval(secs => t.timeout_seconds)
   ORDER BY j.step_started_at ASC
   LIMIT 50`;

export class AdminPipelineMetricsService {
  constructor(private db: QueryableDb = pool) {}

  /** Section A — per render step, from the queue's own timing columns. */
  async getRenderStepStats(from: Date, to: Date): Promise<RenderStepStats[]> {
    const { rows } = await this.db.query(RENDER_STEP_STATS_SQL, [from, to]);
    return rows.map((row) => {
      const total = toInt(row.total);
      const failed = toInt(row.failed);
      return {
        step: String(row.step),
        total,
        claimed: toInt(row.claimed),
        finished: toInt(row.finished),
        failed,
        failureRatePct: total > 0 ? (failed / total) * 100 : 0,
        avgAttempts: toFloat(row.avg_attempts),
        wait: readStats(row, "wait"),
        run: readStats(row, "run"),
      };
    });
  }

  /**
   * Section B — per pipeline step, including the inline AI steps.
   *
   * Gates are flagged, never dropped: `awaiting_*` dwell is a real and useful
   * number (it is how long the requester took to answer), it just has nothing to
   * do with machine time. Averaging the two together would let one requester's
   * overnight approval swamp every render on the page.
   */
  async getPipelineStepStats(from: Date, to: Date): Promise<PipelineStepStats[]> {
    const { rows } = await this.db.query(PIPELINE_STEP_STATS_SQL, [from, to]);
    return rows.map((row) => ({
      step: String(row.step),
      isGate: isGateStep(String(row.step)),
      samples: toInt(row.samples),
      dwell: readStats(row, "dwell"),
    }));
  }

  /** Section D — heavy steps that ran on the web server instead of the worker. */
  async getInlineFallbacks(from: Date, to: Date): Promise<InlineFallbackReport> {
    const pipelineSteps: string[] = [];
    const renderSteps: string[] = [];
    for (const [pipelineStep, mapped] of Object.entries(PIPELINE_STEP_RENDER_STEPS)) {
      for (const renderStep of mapped ?? []) {
        pipelineSteps.push(pipelineStep);
        renderSteps.push(renderStep);
      }
    }

    const { rows } = await this.db.query(INLINE_FALLBACK_SQL, [
      from,
      to,
      pipelineSteps,
      renderSteps,
    ]);

    const mappedRows: InlineFallbackRow[] = rows.map((row) => ({
      step: String(row.step),
      transitions: toInt(row.transitions),
      inline: toInt(row.inline),
    }));

    const totalTransitions = mappedRows.reduce((sum, r) => sum + r.transitions, 0);
    const totalInline = mappedRows.reduce((sum, r) => sum + r.inline, 0);

    return {
      rows: mappedRows,
      totalTransitions,
      totalInline,
      inlineSharePct: totalTransitions > 0 ? (totalInline / totalTransitions) * 100 : 0,
    };
  }

  /** Section E — jobs past the per-step threshold right now (not range-scoped). */
  async getStalledJobs(): Promise<StalledJob[]> {
    const steps = Object.keys(PROCESSING_STEP_TIMEOUT_SECONDS);
    const timeouts = steps.map(
      (step) => PROCESSING_STEP_TIMEOUT_SECONDS[step as VideoGenerationStep] ?? 0
    );

    const { rows } = await this.db.query(STALL_WATCH_SQL, [
      steps,
      timeouts,
      VideoGenerationJobStatus.Active,
      RENDER_QUEUE.staleClaimSeconds,
    ]);

    return rows.map((row) => ({
      jobId: String(row.job_id),
      requestId: String(row.request_id),
      requestTitle: (row.request_title as string | null) ?? null,
      step: String(row.step),
      stalledForMs: toFloat(row.stalled_for_ms),
      thresholdMs: toFloat(row.threshold_ms),
      workerActive: row.worker_active === true,
    }));
  }
}

/**
 * `awaiting_*` is the naming convention for every review gate in
 * `VideoGenerationStep`, so the prefix is the classifier — but it is checked
 * against the enum rather than trusted blindly, because the history table is
 * append-only TEXT and holds legacy values no current enum member covers.
 */
const GATE_STEPS = new Set<string>(
  Object.values(VideoGenerationStep).filter((step) => step.startsWith("awaiting_"))
);

export function isGateStep(step: string): boolean {
  return GATE_STEPS.has(step) || step.startsWith("awaiting_");
}

/**
 * Section C — reduce the live queue snapshot to what the page shows.
 *
 * Pure, so it is testable without a database and without touching
 * `adminDashboardService.getRenderQueueSnapshot()`, which is reused as-is.
 * "Oldest waiting" deliberately looks at QUEUED tasks only: a claimed task is
 * being worked on, and counting its enqueue age as queue wait would make a long
 * render look like a backlog.
 */
export function summariseQueue(
  snapshot: RenderQueueSnapshot,
  now: number = Date.now()
): QueueSummary {
  const queued = snapshot.tasks.filter((task) => task.state === "queued");
  const claimed = snapshot.tasks.filter((task) => task.state === "claimed");

  const oldest = queued.reduce<(typeof queued)[number] | null>(
    (worst, task) =>
      !worst || task.enqueuedAt.getTime() < worst.enqueuedAt.getTime() ? task : worst,
    null
  );

  return {
    workerOnline: snapshot.workerOnline,
    queued: queued.length,
    claimed: claimed.length,
    oldestWaitingMs: oldest ? now - oldest.enqueuedAt.getTime() : null,
    oldestWaitingStep: oldest ? oldest.step : null,
  };
}

/**
 * `analyzing_content` → `Analyzing content`.
 *
 * `PIPELINE_STEP_LABELS` is not reused here: those labels are Thai and written
 * for the requester ("กำลังวิเคราะห์เนื้อหา..."), while this surface is an
 * English admin tool. Deriving the label from the stored value also keeps the
 * raw step name recognisable, which matters when the next thing an admin does
 * is grep the worker log for it.
 */
export function humaniseStep(step: string): string {
  const spaced = step.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const adminPipelineMetricsService = new AdminPipelineMetricsService();
