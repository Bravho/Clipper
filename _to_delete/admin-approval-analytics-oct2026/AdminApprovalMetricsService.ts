import { pool } from "@/lib/db";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { tableExists } from "@/lib/db/tableExists";

/**
 * "When do requesters click, and how often?" — the approval-behaviour side of
 * the CPU-sizing question.
 *
 * Reads `pipeline_gate_events` (migration 028). That table exists because the
 * express lane (`auto_approve_remaining`, migration 026) clears gates on the
 * requester's behalf and `_autoAdvanceIfEnabled()` deliberately reuses a real
 * approver id, so an auto-approval and a human click write byte-identical
 * `video_generation_step_history` rows. `actor_source` is the only column in
 * the database that tells them apart, and mixing auto-approvals into the
 * time-of-day profile would smear the human peak the render worker actually has
 * to survive.
 *
 * NO REPOSITORY ON PURPOSE. These are aggregate reads, not a domain model;
 * `ManagementAuditService`, `GateEventService` and `AdminFeedbackService` all
 * talk to their own table through the shared pool for the same reason. The pool
 * is constructor-injected (the `ManagementAuditService` pattern) so the tests
 * run without a socket.
 *
 * TIMEZONE. Everything hour- or day-bucketed goes through
 * `AT TIME ZONE 'Asia/Bangkok'`. The columns are TIMESTAMPTZ (UTC): a 7am
 * Bangkok approval is midnight UTC, so an unconverted EXTRACT would put it on
 * the previous day and shift the whole time-of-day analysis by seven hours.
 *
 * PRE-INSTRUMENTATION FALLBACK. `pipeline_gate_events` starts empty and only
 * fills from the moment migration 028 shipped and the pipeline began calling
 * `GateEventService`. For any range with no rows the service falls back to
 * deriving click times from `video_generation_step_history` and marks the whole
 * result `mode: "estimated"`. Every consumer must say so on screen: in that
 * mode human and auto approvals genuinely cannot be separated, and claiming
 * otherwise would be inventing precision.
 */

/** Minimal `pg` pool surface, so a stub can stand in for a real Pool. */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface MetricsRange {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}

/**
 * Which source the numbers came from.
 *
 * `instrumented` — real gate events, human vs auto is real.
 * `estimated`    — reconstructed from step history; actor is unknowable.
 */
export type ApprovalDataMode = "instrumented" | "estimated";

/** One heatmap cell, in the shape `<HourHeatmap>` expects. */
export interface ApprovalHourCell {
  /** 0 = Sunday, matching Postgres `EXTRACT(DOW)`. */
  dayOfWeek: number;
  /** 0–23 in Bangkok. */
  hour: number;
  count: number;
}

/** The busiest hour of the week, and what that is as a rate. */
export interface ApprovalPeak {
  dayOfWeek: number;
  hour: number;
  /** Clicks summed over every occurrence of that weekday-hour in the range. */
  count: number;
  /** How many times that weekday-hour occurred in the range. */
  occurrences: number;
  /** `count / occurrences` — clicks per hour in the busiest hour. */
  ratePerHour: number;
}

export interface ClicksPerJobRow {
  /** `express` = the job took `auto_approve_remaining`. */
  lane: "express" | "manual";
  jobs: number;
  meanClicks: number;
  medianClicks: number;
  totalClicks: number;
}

export interface GateActorRow {
  step: string;
  human: number;
  auto: number;
  system: number;
  /** Resolved with no `actor_source` written — older rows, or a missed call site. */
  unattributed: number;
  total: number;
}

export interface GateDwellRow {
  step: string;
  samples: number;
  meanSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
}

export interface NotificationEffectRow {
  /** True = a push actually went out (`notified_at IS NOT NULL`). */
  notified: boolean;
  samples: number;
  meanSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
}

export interface AbandonmentRow {
  step: string;
  /** Gates still open right now. */
  openNow: number;
  /** Of those, open longer than the 72h abandonment threshold. */
  stalled: number;
  /** Explicitly closed as `abandoned`. Always 0 in estimated mode. */
  abandoned: number;
}

export interface ApprovalMetrics {
  mode: ApprovalDataMode;
  /** `MIN(opened_at)` over the whole table — when instrumentation began. */
  firstInstrumentedAt: Date | null;
  /** Gate rows opened inside the range. Zero is what triggers the fallback. */
  gateEventsInRange: number;
  heatmap: ApprovalHourCell[];
  peak: ApprovalPeak | null;
  clicksPerJob: ClicksPerJobRow[];
  actorSplit: GateActorRow[];
  dwell: GateDwellRow[];
  /** Null in estimated mode: step history has no notification timestamp. */
  notification: NotificationEffectRow[] | null;
  abandonment: AbandonmentRow[];
  openNowTotal: number;
  stalledNowTotal: number;
}

/** A gate open longer than this with nobody acting on it is treated as abandoned. */
export const ABANDONMENT_THRESHOLD_HOURS = 72;

/**
 * English labels for the requester review gates.
 *
 * `PIPELINE_STEP_LABELS` is Thai — correct for requesters, wrong for an admin
 * surface that also has to be readable by whoever is sizing the hardware. The
 * raw `awaiting_*` value is rendered next to the label everywhere so a row can
 * still be matched to the enum, the SQL and the log line.
 */
export const GATE_STEP_LABELS: Record<string, string> = {
  [VideoGenerationStep.AwaitingContentApproval]: "Speaking script",
  [VideoGenerationStep.AwaitingVoiceApproval]: "Voiceover",
  [VideoGenerationStep.AwaitingSceneDesignApproval]: "Scene plan",
  [VideoGenerationStep.AwaitingSceneScriptApproval]: "Scene script (per scene)",
  [VideoGenerationStep.AwaitingVideoApproval]: "Scene clip (per scene)",
  [VideoGenerationStep.AwaitingAnimationApproval]: "Animation / music",
  [VideoGenerationStep.AwaitingFinalApproval]: "Merged video",
  [VideoGenerationStep.AwaitingOverlayApproval]: "Subtitled video",
  [VideoGenerationStep.AwaitingAdditionalRatios]: "Extra channel ratios",
  [VideoGenerationStep.AwaitingDistributionReview]: "Download & deliver",
  // Legacy, kept so old rows render as something other than a bare enum value.
  [VideoGenerationStep.AwaitingVoiceRecording]: "Voice recording (legacy)",
};

/** Label for a step value read back from the database. */
export function gateStepLabel(step: string): string {
  return GATE_STEP_LABELS[step] ?? step;
}

/**
 * `pg` hands back `COUNT(*)`, BIGINT and NUMERIC as STRINGS (the precedent is
 * `PostgresClipRequestRepository.countByStatus()`). Every aggregate below is
 * already cast in SQL; this is the second belt so a forgotten `::float8`
 * degrades to 0 rather than to `"12" + 1 === "121"`.
 */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * `1.4s` / `2m 30s` / `1h 12m`. Never raw milliseconds, and never `4523s`.
 *
 * Gate waits span six orders of magnitude — a requester who is watching clicks
 * in a second, one who is asleep waits nine hours — so the unit has to follow
 * the magnitude or every table is unreadable at one end of its range.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.round((seconds % 86_400) / 3600);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/**
 * How many times each (day-of-week, hour) slot occurs inside the range, in
 * Bangkok.
 *
 * A count alone is not a rate: "40 clicks on Monday 20:00" over a 90-day window
 * is thirteen Mondays, not one. The capacity model consumes an arrival RATE, so
 * the peak cell has to be divided by its own number of occurrences. Computed by
 * walking hour slots rather than assuming `days / 7`, because a range is rarely
 * a whole number of weeks.
 */
export function countHourSlots(from: Date, to: Date): number[][] {
  const slots: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const HOUR_MS = 3_600_000;
  // Thailand has no daylight saving, so a fixed +07:00 shift is exact.
  const BANGKOK_OFFSET_MS = 7 * HOUR_MS;

  const start = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS;
  for (let t = start; t < to.getTime(); t += HOUR_MS) {
    if (t < from.getTime()) continue;
    const local = new Date(t + BANGKOK_OFFSET_MS);
    slots[local.getUTCDay()][local.getUTCHours()] += 1;
  }
  return slots;
}

/** Peak cell of a heatmap, expressed as a rate. Null when there is nothing. */
export function findPeak(
  cells: ApprovalHourCell[],
  range: MetricsRange
): ApprovalPeak | null {
  let best: ApprovalHourCell | null = null;
  for (const cell of cells) {
    if (cell.count <= 0) continue;
    if (!best || cell.count > best.count) best = cell;
  }
  if (!best) return null;

  const slots = countHourSlots(range.from, range.to);
  const occurrences = slots[best.dayOfWeek]?.[best.hour] ?? 0;
  return {
    dayOfWeek: best.dayOfWeek,
    hour: best.hour,
    count: best.count,
    occurrences,
    ratePerHour: occurrences > 0 ? best.count / occurrences : best.count,
  };
}

/**
 * Steps whose value marks a requester review gate.
 *
 * `LEFT(step, 9) = 'awaiting_'` rather than a hand-maintained IN list, and
 * rather than `LIKE 'awaiting\_%'` whose escape depends on
 * `standard_conforming_strings`. A gate added to the enum is picked up for free;
 * a hard-coded list would silently omit it.
 */
function gatePredicate(column: string): string {
  return `LEFT(${column}, 9) = 'awaiting_'`;
}

export class AdminApprovalMetricsService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * Everything the approvals page shows, in one call.
   *
   * The mode probe runs first and alone: which of the two query sets to run
   * depends on its answer, and running both would double the cost of the page
   * for data that is thrown away.
   */
  async getMetrics(range: MetricsRange): Promise<ApprovalMetrics> {
    const probe = await this.probeInstrumentation(range);

    if (probe.gateEventsInRange > 0) {
      return this.instrumentedMetrics(
        range,
        probe.firstInstrumentedAt,
        probe.gateEventsInRange
      );
    }
    return this.estimatedMetrics(range, probe.firstInstrumentedAt);
  }

  /**
   * Is there real gate instrumentation for this range?
   *
   * Detected from the data (`MIN(opened_at)` plus an in-range count), never
   * from a hard-coded cutover date: the migration lands in different
   * environments on different days, and a date constant would claim
   * instrumentation on a staging database that has none.
   */
  async probeInstrumentation(
    range: MetricsRange
  ): Promise<{ firstInstrumentedAt: Date | null; gateEventsInRange: number }> {
    // Migration 028 may not have reached this database. A missing table is not
    // an error here — it is simply the pre-instrumentation state, which this
    // service already knows how to report, so fall through to estimated mode
    // rather than taking the page down with `relation does not exist`.
    if (!(await tableExists("pipeline_gate_events", this.db))) {
      return { firstInstrumentedAt: null, gateEventsInRange: 0 };
    }

    const { rows } = await this.db.query(
      `SELECT MIN(opened_at) AS first_opened_at,
              COUNT(*) FILTER (WHERE opened_at >= $1 AND opened_at < $2)::int AS in_range
         FROM pipeline_gate_events`,
      [range.from, range.to]
    );
    const row = rows[0] ?? {};
    return {
      firstInstrumentedAt: asDate(row.first_opened_at),
      gateEventsInRange: num(row.in_range),
    };
  }

  // ── Instrumented mode ─────────────────────────────────────────────────────

  private async instrumentedMetrics(
    range: MetricsRange,
    firstInstrumentedAt: Date | null,
    gateEventsInRange: number
  ): Promise<ApprovalMetrics> {
    const [
      heatmap,
      clicksPerJob,
      actorSplit,
      dwell,
      notification,
      abandonment,
      openNow,
    ] = await Promise.all([
      this.humanClickHeatmap(range),
      this.humanClicksPerJob(range),
      this.actorSplitByStep(range),
      this.dwellByStep(range),
      this.notificationEffect(range),
      this.abandonmentByStep(range),
      this.openGateTotals(),
    ]);

    return {
      mode: "instrumented",
      firstInstrumentedAt,
      gateEventsInRange,
      heatmap,
      peak: findPeak(heatmap, range),
      clicksPerJob,
      actorSplit,
      dwell,
      notification,
      abandonment,
      openNowTotal: openNow.openNow,
      stalledNowTotal: openNow.stalled,
    };
  }

  /**
   * Human gate resolutions by Bangkok weekday and hour.
   *
   * `actor_source = 'human'` is the whole point of the table. Express-lane
   * auto-approvals fire whenever the render worker happens to finish the
   * preceding step — 03:00 as readily as 13:00 — so including them would flatten
   * exactly the peak this chart exists to find.
   */
  private async humanClickHeatmap(range: MetricsRange): Promise<ApprovalHourCell[]> {
    const { rows } = await this.db.query(
      `SELECT EXTRACT(DOW  FROM resolved_at AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS day_of_week,
              EXTRACT(HOUR FROM resolved_at AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS hour,
              COUNT(*)::int AS count
         FROM pipeline_gate_events
        WHERE resolved_at >= $1
          AND resolved_at <  $2
          AND actor_source = 'human'
        GROUP BY 1, 2`,
      [range.from, range.to]
    );
    return rows.map((row) => ({
      dayOfWeek: num(row.day_of_week),
      hour: num(row.hour),
      count: num(row.count),
    }));
  }

  /**
   * Human clicks per completed job, express lane vs manual.
   *
   * The headline comparison: a manual job passes roughly eight gates, an
   * express-lane job stops at about three and the pipeline clears the rest. The
   * difference is the click budget the express lane buys back.
   *
   * `j.id::text = p.job_id` is not optional. `video_generation_jobs.id` is TEXT
   * in the DDL but uuid in some environments, while `pipeline_gate_events.job_id`
   * is TEXT with no FK by design (migration 028 follows `render_tasks`). An
   * uncast comparison compiles in one environment and throws
   * `operator does not exist: uuid = text` in the other.
   */
  private async humanClicksPerJob(range: MetricsRange): Promise<ClicksPerJobRow[]> {
    const { rows } = await this.db.query(
      `WITH per_job AS (
         SELECT job_id, COUNT(*)::int AS clicks
           FROM pipeline_gate_events
          WHERE actor_source = 'human'
            AND resolved_at >= $1
            AND resolved_at <  $2
          GROUP BY job_id
       )
       SELECT j.auto_approve_remaining AS express,
              COUNT(*)::int                                                    AS jobs,
              COALESCE(SUM(p.clicks), 0)::int                                  AS total_clicks,
              COALESCE(AVG(p.clicks), 0)::float8                               AS mean_clicks,
              COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.clicks), 0)::float8 AS median_clicks
         FROM per_job p
         JOIN video_generation_jobs j ON j.id::text = p.job_id::text
        WHERE j.status = 'complete'
        GROUP BY j.auto_approve_remaining`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      lane: row.express === true ? ("express" as const) : ("manual" as const),
      jobs: num(row.jobs),
      totalClicks: num(row.total_clicks),
      meanClicks: num(row.mean_clicks),
      medianClicks: num(row.median_clicks),
    }));
  }

  /** Who resolved each gate. The table nothing else in the codebase can answer. */
  private async actorSplitByStep(range: MetricsRange): Promise<GateActorRow[]> {
    const { rows } = await this.db.query(
      `SELECT step,
              COUNT(*) FILTER (WHERE actor_source = 'human')::int  AS human,
              COUNT(*) FILTER (WHERE actor_source = 'auto')::int   AS auto,
              COUNT(*) FILTER (WHERE actor_source = 'system')::int AS system,
              COUNT(*) FILTER (WHERE actor_source IS NULL)::int    AS unattributed,
              COUNT(*)::int                                        AS total
         FROM pipeline_gate_events
        WHERE resolved_at >= $1
          AND resolved_at <  $2
        GROUP BY step
        ORDER BY total DESC`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      step: String(row.step ?? ""),
      human: num(row.human),
      auto: num(row.auto),
      system: num(row.system),
      unattributed: num(row.unattributed),
      total: num(row.total),
    }));
  }

  /**
   * How long humans sit at each gate.
   *
   * Human-only and mean/median/p90 together: auto-approvals resolve in
   * milliseconds and would drag every mean towards zero, and the median alone
   * hides the overnight tail that actually holds the job — and therefore the
   * worker's inputs — in place.
   */
  private async dwellByStep(range: MetricsRange): Promise<GateDwellRow[]> {
    const { rows } = await this.db.query(
      `SELECT step,
              COUNT(*)::int                                                       AS samples,
              AVG(wait_seconds)::float8                                           AS mean_seconds,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_seconds)::float8   AS median_seconds,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wait_seconds)::float8   AS p90_seconds
         FROM pipeline_gate_events
        WHERE resolved_at >= $1
          AND resolved_at <  $2
          AND actor_source = 'human'
          AND wait_seconds IS NOT NULL
        GROUP BY step
        ORDER BY median_seconds DESC NULLS LAST`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      step: String(row.step ?? ""),
      samples: num(row.samples),
      meanSeconds: num(row.mean_seconds),
      medianSeconds: num(row.median_seconds),
      p90Seconds: num(row.p90_seconds),
    }));
  }

  /**
   * Dwell with a push versus dwell without one.
   *
   * A NULL `notified_at` is data, not a gap: the express lane deliberately
   * suppresses the push on gates it will clear itself, and a failed or opted-out
   * device leaves it NULL too. The comparison answers whether the notification
   * is what ends the wait — which is the same as asking how long a job holds its
   * inputs and its queue slot for no reason.
   */
  private async notificationEffect(
    range: MetricsRange
  ): Promise<NotificationEffectRow[]> {
    const { rows } = await this.db.query(
      `SELECT (notified_at IS NOT NULL)                                          AS notified,
              COUNT(*)::int                                                      AS samples,
              AVG(wait_seconds)::float8                                          AS mean_seconds,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_seconds)::float8  AS median_seconds,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wait_seconds)::float8  AS p90_seconds
         FROM pipeline_gate_events
        WHERE resolved_at >= $1
          AND resolved_at <  $2
          AND actor_source = 'human'
          AND wait_seconds IS NOT NULL
        GROUP BY 1
        ORDER BY 1 DESC`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      notified: row.notified === true,
      samples: num(row.samples),
      meanSeconds: num(row.mean_seconds),
      medianSeconds: num(row.median_seconds),
      p90Seconds: num(row.p90_seconds),
    }));
  }

  /**
   * Gates nobody came back to.
   *
   * Counted from `opened_at` inside the range so the row is attributable to when
   * the gate appeared, and `resolved_at IS NULL` is evaluated as of NOW() — a
   * gate opened three weeks ago and still open is still open regardless of which
   * window you are looking at.
   */
  private async abandonmentByStep(range: MetricsRange): Promise<AbandonmentRow[]> {
    const { rows } = await this.db.query(
      `SELECT step,
              COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open_now,
              COUNT(*) FILTER (
                WHERE resolved_at IS NULL
                  AND opened_at < NOW() - ($3 || ' hours')::interval
              )::int AS stalled,
              COUNT(*) FILTER (WHERE resolution = 'abandoned')::int AS abandoned
         FROM pipeline_gate_events
        WHERE opened_at >= $1
          AND opened_at <  $2
        GROUP BY step
       HAVING COUNT(*) FILTER (WHERE resolved_at IS NULL) > 0
           OR COUNT(*) FILTER (WHERE resolution = 'abandoned') > 0
        ORDER BY stalled DESC, open_now DESC`,
      [range.from, range.to, String(ABANDONMENT_THRESHOLD_HOURS)]
    );

    return rows.map((row) => ({
      step: String(row.step ?? ""),
      openNow: num(row.open_now),
      stalled: num(row.stalled),
      abandoned: num(row.abandoned),
    }));
  }

  /**
   * Open gates right now, across all time.
   *
   * Deliberately unfiltered by the range: "how many requesters are we waiting on
   * at this moment" is a property of the present, and a 7-day window would hide
   * the eight-week-old gate that is the actual problem.
   */
  private async openGateTotals(): Promise<{ openNow: number; stalled: number }> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS open_now,
              COUNT(*) FILTER (WHERE opened_at < NOW() - ($1 || ' hours')::interval)::int AS stalled
         FROM pipeline_gate_events
        WHERE resolved_at IS NULL`,
      [String(ABANDONMENT_THRESHOLD_HOURS)]
    );
    const row = rows[0] ?? {};
    return { openNow: num(row.open_now), stalled: num(row.stalled) };
  }

  // ── Estimated (pre-instrumentation) mode ──────────────────────────────────

  /**
   * The same questions, answered from `video_generation_step_history`.
   *
   * A click is not recorded anywhere in the old schema, but its EFFECT is: the
   * pipeline writes a history row for the step the click started, so a click at
   * `awaiting_video_approval` shows up as the `merging_scenes` row that follows
   * it. Every history row whose immediate predecessor (by `created_at` within
   * the same job) is an `awaiting_*` step is therefore a click, timed at that
   * row's `created_at`, and the gap between the two rows is the dwell.
   *
   * Derived with `LAG` over the job's own sequence rather than a hand-written
   * gate→next-step map: the per-scene loop means `awaiting_video_approval` can
   * be followed by either the next scene's gate or `merging_scenes`, and any
   * fixed map would have to be maintained in lockstep with the pipeline.
   *
   * WHAT THIS MODE CANNOT DO: separate human from auto. `_autoAdvanceIfEnabled`
   * writes the identical rows. Every number here is labelled estimated, and the
   * actor split is reported as unattributed rather than guessed.
   */
  private async estimatedMetrics(
    range: MetricsRange,
    firstInstrumentedAt: Date | null
  ): Promise<ApprovalMetrics> {
    const [heatmap, clicksPerJob, dwell, actorSplit, abandonment] = await Promise.all([
      this.estimatedHeatmap(range),
      this.estimatedClicksPerJob(range),
      this.estimatedDwellByStep(range),
      this.estimatedActorSplit(range),
      this.estimatedAbandonment(),
    ]);

    return {
      mode: "estimated",
      firstInstrumentedAt,
      gateEventsInRange: 0,
      heatmap,
      peak: findPeak(heatmap, range),
      clicksPerJob,
      actorSplit,
      dwell,
      // No `notified_at` exists before instrumentation. Null, not an empty
      // array: "we cannot know" and "we measured zero" are different answers.
      notification: null,
      abandonment,
      openNowTotal: abandonment.reduce((sum, row) => sum + row.openNow, 0),
      stalledNowTotal: abandonment.reduce((sum, row) => sum + row.stalled, 0),
    };
  }

  /**
   * The `LAG` sequence every estimated query is built on.
   *
   * The window runs over the job's WHOLE history, unfiltered, and the range
   * predicate is applied afterwards — filtering first would make the first row
   * inside the window look like a click out of whatever preceded the window.
   */
  private estimatedClickCte(): string {
    return `
      WITH sequenced AS (
        SELECT job_id,
               step,
               created_at,
               LAG(step)       OVER (PARTITION BY job_id ORDER BY created_at, id) AS prev_step,
               LAG(created_at) OVER (PARTITION BY job_id ORDER BY created_at, id) AS prev_at
          FROM video_generation_step_history
      ),
      clicks AS (
        SELECT job_id,
               prev_step AS gate_step,
               created_at AS clicked_at,
               EXTRACT(EPOCH FROM (created_at - prev_at))::float8 AS wait_seconds
          FROM sequenced
         WHERE prev_step IS NOT NULL
           AND ${gatePredicate("prev_step")}
           AND created_at >= $1
           AND created_at <  $2
      )`;
  }

  private async estimatedHeatmap(range: MetricsRange): Promise<ApprovalHourCell[]> {
    const { rows } = await this.db.query(
      `${this.estimatedClickCte()}
       SELECT EXTRACT(DOW  FROM clicked_at AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS day_of_week,
              EXTRACT(HOUR FROM clicked_at AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS hour,
              COUNT(*)::int AS count
         FROM clicks
        GROUP BY 1, 2`,
      [range.from, range.to]
    );
    return rows.map((row) => ({
      dayOfWeek: num(row.day_of_week),
      hour: num(row.hour),
      count: num(row.count),
    }));
  }

  private async estimatedClicksPerJob(range: MetricsRange): Promise<ClicksPerJobRow[]> {
    const { rows } = await this.db.query(
      `${this.estimatedClickCte()},
       per_job AS (
         SELECT job_id, COUNT(*)::int AS clicks FROM clicks GROUP BY job_id
       )
       SELECT j.auto_approve_remaining AS express,
              COUNT(*)::int                                                    AS jobs,
              COALESCE(SUM(p.clicks), 0)::int                                  AS total_clicks,
              COALESCE(AVG(p.clicks), 0)::float8                               AS mean_clicks,
              COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.clicks), 0)::float8 AS median_clicks
         FROM per_job p
         JOIN video_generation_jobs j ON j.id::text = p.job_id::text
        WHERE j.status = 'complete'
        GROUP BY j.auto_approve_remaining`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      lane: row.express === true ? ("express" as const) : ("manual" as const),
      jobs: num(row.jobs),
      totalClicks: num(row.total_clicks),
      meanClicks: num(row.mean_clicks),
      medianClicks: num(row.median_clicks),
    }));
  }

  private async estimatedDwellByStep(range: MetricsRange): Promise<GateDwellRow[]> {
    const { rows } = await this.db.query(
      `${this.estimatedClickCte()}
       SELECT gate_step AS step,
              COUNT(*)::int                                                      AS samples,
              AVG(wait_seconds)::float8                                          AS mean_seconds,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_seconds)::float8  AS median_seconds,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wait_seconds)::float8  AS p90_seconds
         FROM clicks
        GROUP BY gate_step
        ORDER BY median_seconds DESC NULLS LAST`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      step: String(row.step ?? ""),
      samples: num(row.samples),
      meanSeconds: num(row.mean_seconds),
      medianSeconds: num(row.median_seconds),
      p90Seconds: num(row.p90_seconds),
    }));
  }

  /**
   * Volume per gate, with the actor column honestly empty.
   *
   * The row shape matches instrumented mode so the page renders one table, but
   * everything lands in `unattributed` — the source cannot distinguish a human
   * click from `_autoAdvanceIfEnabled` clearing the gate.
   */
  private async estimatedActorSplit(range: MetricsRange): Promise<GateActorRow[]> {
    const { rows } = await this.db.query(
      `${this.estimatedClickCte()}
       SELECT gate_step AS step, COUNT(*)::int AS total
         FROM clicks
        GROUP BY gate_step
        ORDER BY total DESC`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      step: String(row.step ?? ""),
      human: 0,
      auto: 0,
      system: 0,
      unattributed: num(row.total),
      total: num(row.total),
    }));
  }

  /**
   * Open gates approximated from the jobs themselves.
   *
   * Without gate rows the only evidence a job is waiting is that it is `active`
   * and parked on an `awaiting_*` step; the only evidence of HOW LONG is
   * `updated_at`, which any unrelated write to the job also bumps. So this
   * undercounts the wait and is labelled estimated like everything else here.
   */
  private async estimatedAbandonment(): Promise<AbandonmentRow[]> {
    const { rows } = await this.db.query(
      `SELECT current_step AS step,
              COUNT(*)::int AS open_now,
              COUNT(*) FILTER (WHERE updated_at < NOW() - ($1 || ' hours')::interval)::int AS stalled
         FROM video_generation_jobs
        WHERE status = 'active'
          AND ${gatePredicate("current_step")}
        GROUP BY current_step
        ORDER BY stalled DESC, open_now DESC`,
      [String(ABANDONMENT_THRESHOLD_HOURS)]
    );

    return rows.map((row) => ({
      step: String(row.step ?? ""),
      openNow: num(row.open_now),
      stalled: num(row.stalled),
      // The old schema never marks a gate abandoned; it just stops changing.
      abandoned: 0,
    }));
  }
}

export const adminApprovalMetricsService = new AdminApprovalMetricsService();
