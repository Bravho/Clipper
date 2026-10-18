import { pool } from "@/lib/db";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import { tableExists } from "@/lib/db/tableExists";
import { VideoGenerationStep as S } from "@/domain/enums/VideoGenerationStep";
import {
  STUDIO_ACTIONS,
  STUDIO_STEPS,
  STUDIO_STEP_LABELS,
  type StudioActionName,
  type StudioStepName,
} from "@/config/studioEvents";
import {
  toInt,
  toNumberOrNull,
  type MetricsRange,
} from "@/services/admin/analyticsShared";

/**
 * Studio Activity — what people DO on each studio step (replaces the old
 * "Approval clicks" page, Oct 2026).
 *
 * There is no staff or admin approval any more: every gate is the requester's
 * own button inside the studio, so "when do approvals bunch up" stopped being
 * the question. The questions now are, per studio step: how many people got
 * there, how long they stayed, how many visits ended there, which buttons they
 * pressed (and how often they had to press "again"), and what went wrong —
 * AI steps that failed, phone renders that failed, downloads that were blocked.
 *
 * ACTIVITY BASIS, not cohort: everything here is what happened inside the
 * range, by anyone. The new-user cohort view is the Conversion Funnel.
 *
 * Two kinds of source, said on the page:
 *   - studio_events (migration 041): screens and clicks. Only exists from the
 *     day that migration and the tracker shipped.
 *   - pipeline tables (step history, gate events, phone render attempts):
 *     retroactive, and the only truth about what the server actually did.
 *
 * Every user/request id join casts both sides to text (see AdminFunnelService).
 */

interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A visit that sat on one screen longer than this is a phone left open, not time spent. */
const STEP_TIME_CAP_SECONDS = 2 * 60 * 60;

export interface ActivityTotals {
  newUsers: number;
  /** Distinct users with any studio event. */
  studioUsers: number;
  studioVisits: number;
  briefsSaved: number;
  submissions: number;
  mainVideos: number;
  finished: number;
  phoneRendersOk: number;
  phoneRendersFailed: number;
}

export interface StepActivityRow {
  step: StudioStepName;
  label: string;
  users: number;
  views: number;
  visits: number;
  /** Visits whose last screen was this step. */
  visitsEndedHere: number;
  /** Median seconds on this step per view (capped), null with no data. */
  medianSeconds: number | null;
  /** Actions on this step, most frequent first. */
  actions: ActionRow[];
}

export interface ActionRow {
  action: StudioActionName;
  label: string;
  count: number;
  users: number;
  requests: number;
}

/** Server-side decisions and AI waits, from pipeline tables (retroactive). */
export interface PipelineStepRow {
  key: string;
  label: string;
  /** Who is waiting: the person (a decision) or the server (AI/phone work). */
  kind: "decision" | "ai";
  /** Requests that reached this point inside the range. */
  reached: number;
  /** Median seconds spent there. */
  medianSeconds: number | null;
  /** 90th percentile, for the long tail. */
  p90Seconds: number | null;
  /** Requests sitting here right now (open gate / current step), any age. */
  waitingNow: number;
}

export interface FailureRow {
  label: string;
  count: number;
}

export interface PhoneRenderRow {
  platform: string;
  stage: string;
  attempts: number;
  completed: number;
  failed: number;
  /** Lease ran out or the person stopped. */
  abandoned: number;
  medianSeconds: number | null;
}

export interface DailyActivityPoint {
  date: string;
  newUsers: number;
  studioUsers: number;
  submissions: number;
  mainVideos: number;
}

export interface HourCellRow {
  dayOfWeek: number;
  hour: number;
  count: number;
}

export interface StudioActivityReport {
  studioTracking: boolean;
  totals: ActivityTotals;
  steps: StepActivityRow[];
  pipeline: PipelineStepRow[];
  pipelineFailures: FailureRow[];
  phoneRenders: PhoneRenderRow[];
  phoneErrors: FailureRow[];
  daily: DailyActivityPoint[];
  hours: HourCellRow[];
  /** Voice remakes per request that made a voice; null without data. */
  voiceRemakesPerRequest: number | null;
}

const EMPTY_STUDIO = `(SELECT NULL::uuid AS user_id, ''::text AS kind, ''::text AS action,
                              ''::text AS session_id, ''::text AS step, ''::text AS request_id,
                              NULL::timestamptz AS occurred_at WHERE false)`;

function withStudio(sql: string, available: boolean): string {
  return available ? sql : sql.split("FROM studio_events se").join(`FROM ${EMPTY_STUDIO} se`);
}

// ── studio_events ────────────────────────────────────────────────────────────

const STEP_SQL = `
  WITH ev AS (
    SELECT se.session_id, se.user_id, se.kind, se.step, se.occurred_at
      FROM studio_events se
     WHERE se.occurred_at >= $1 AND se.occurred_at < $2
  ),
  views AS (
    SELECT session_id, user_id, step, occurred_at,
           LEAD(occurred_at) OVER w AS next_view_at,
           MAX(occurred_at) OVER (PARTITION BY session_id) AS session_end,
           ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY occurred_at DESC) AS from_end
      FROM ev
     WHERE kind = 'step_view'
    WINDOW w AS (PARTITION BY session_id ORDER BY occurred_at)
  )
  SELECT step,
         COUNT(DISTINCT user_id)::int                         AS users,
         COUNT(*)::int                                        AS views,
         COUNT(DISTINCT session_id)::int                      AS visits,
         COUNT(*) FILTER (WHERE from_end = 1)::int            AS ended_here,
         -- The last screen of a visit with nothing after it has no measurable
         -- time (the person left); it is not counted as zero seconds.
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY LEAST(${STEP_TIME_CAP_SECONDS},
                          EXTRACT(EPOCH FROM (COALESCE(next_view_at, session_end) - occurred_at)))
         ) FILTER (WHERE next_view_at IS NOT NULL OR session_end > occurred_at)::float8
                                                              AS median_seconds
    FROM views
   GROUP BY step`;

const ACTION_SQL = `
  SELECT se.action,
         COUNT(*)::int                       AS count,
         COUNT(DISTINCT se.user_id)::int     AS users,
         COUNT(DISTINCT se.request_id)::int  AS requests
    FROM studio_events se
   WHERE se.kind = 'action'
     AND se.occurred_at >= $1 AND se.occurred_at < $2
   GROUP BY se.action`;

const STUDIO_TOTALS_SQL = `
  SELECT COUNT(DISTINCT se.user_id)::int    AS users,
         COUNT(DISTINCT se.session_id)::int AS visits
    FROM studio_events se
   WHERE se.occurred_at >= $1 AND se.occurred_at < $2`;

const HOURS_SQL = `
  SELECT EXTRACT(DOW  FROM se.occurred_at AT TIME ZONE $3)::int AS dow,
         EXTRACT(HOUR FROM se.occurred_at AT TIME ZONE $3)::int AS hour,
         COUNT(*)::int AS count
    FROM studio_events se
   WHERE se.occurred_at >= $1 AND se.occurred_at < $2
     AND se.kind IN ('step_view', 'action')
   GROUP BY 1, 2`;

// ── pipeline tables (retroactive) ────────────────────────────────────────────

const PIPELINE_TOTALS_SQL = `
  SELECT
    (SELECT COUNT(*)::int FROM users u
      WHERE u.deleted_at IS NULL AND COALESCE(u.role, 'requester') <> 'admin'
        AND u.created_at >= $1 AND u.created_at < $2)                         AS new_users,
    (SELECT COUNT(*)::int FROM clip_requests cr
      WHERE cr.created_at >= $1 AND cr.created_at < $2)                       AS briefs,
    (SELECT COUNT(*)::int FROM video_generation_jobs j
      WHERE j.created_at >= $1 AND j.created_at < $2)                         AS submissions,
    (SELECT COUNT(DISTINCT h.job_id)::int FROM video_generation_step_history h
      WHERE h.step = '${S.AwaitingOverlayApproval}'
        AND h.created_at >= $1 AND h.created_at < $2)                         AS main_videos,
    (SELECT COUNT(DISTINCT h.job_id)::int FROM video_generation_step_history h
      WHERE h.step IN ('${S.AwaitingDistributionReview}', '${S.Complete}')
        AND h.created_at >= $1 AND h.created_at < $2)                         AS finished`;

/**
 * Time between consecutive pipeline steps, per job, from step history: how
 * long each step lasted before the next one began. A gate step's duration is
 * the person deciding; a generating step's is the AI or the phone working.
 */
const STEP_DURATION_SQL = `
  WITH h AS (
    SELECT h.job_id::text AS job_id, h.step, h.created_at,
           LEAD(h.created_at) OVER (PARTITION BY h.job_id ORDER BY h.created_at, h.id) AS next_at
      FROM video_generation_step_history h
  )
  SELECT step,
         COUNT(DISTINCT job_id)::int AS reached,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (next_at - created_at)))
           FILTER (WHERE next_at IS NOT NULL)::float8 AS median_seconds,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (next_at - created_at)))
           FILTER (WHERE next_at IS NOT NULL)::float8 AS p90_seconds
    FROM h
   WHERE created_at >= $1 AND created_at < $2
   GROUP BY step`;

const WAITING_NOW_SQL = `
  SELECT j.current_step AS step, COUNT(*)::int AS waiting
    FROM video_generation_jobs j
   WHERE j.current_step NOT IN ('${S.Complete}', '${S.Failed}')
   GROUP BY j.current_step`;

const PIPELINE_FAILURES_SQL = `
  SELECT COALESCE(j.failed_at_step, 'unknown') AS step, COUNT(*)::int AS count
    FROM video_generation_jobs j
   WHERE j.current_step = '${S.Failed}'
     AND j.updated_at >= $1 AND j.updated_at < $2
   GROUP BY 1
   ORDER BY 2 DESC`;

const PHONE_RENDER_SQL = `
  SELECT COALESCE(a.platform, 'unknown') AS platform,
         a.stage,
         COUNT(*)::int                                                     AS attempts,
         COUNT(*) FILTER (WHERE a.state = 'completed')::int                AS completed,
         COUNT(*) FILTER (WHERE a.state = 'failed')::int                   AS failed,
         COUNT(*) FILTER (WHERE a.state IN ('expired', 'released'))::int   AS abandoned,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.updated_at - a.created_at)))
           FILTER (WHERE a.state = 'completed')::float8                    AS median_seconds
    FROM device_render_attempts a
   WHERE a.created_at >= $1 AND a.created_at < $2
   GROUP BY 1, 2
   ORDER BY 1, 2`;

const PHONE_ERRORS_SQL = `
  SELECT a.stage || ' · ' || COALESCE(a.platform, '?') || ' — ' ||
           LEFT(COALESCE(NULLIF(a.error, ''), 'no reason given'), 120) AS label,
         COUNT(*)::int AS count
    FROM device_render_attempts a
   WHERE a.state = 'failed'
     AND a.created_at >= $1 AND a.created_at < $2
   GROUP BY 1
   ORDER BY 2 DESC
   LIMIT 10`;

const DAILY_SQL = `
  WITH days AS (
    SELECT generate_series(
             ($1::timestamptz AT TIME ZONE $3)::date,
             (($2::timestamptz AT TIME ZONE $3)::date - INTERVAL '1 day')::date,
             INTERVAL '1 day'
           )::date AS day
  ),
  signups AS (
    SELECT (u.created_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS n
      FROM users u
     WHERE u.deleted_at IS NULL AND COALESCE(u.role, 'requester') <> 'admin'
       AND u.created_at >= $1 AND u.created_at < $2
     GROUP BY 1
  ),
  studio AS (
    SELECT (se.occurred_at AT TIME ZONE $3)::date AS day, COUNT(DISTINCT se.user_id)::int AS n
      FROM studio_events se
     WHERE se.occurred_at >= $1 AND se.occurred_at < $2
     GROUP BY 1
  ),
  subs AS (
    SELECT (j.created_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS n
      FROM video_generation_jobs j
     WHERE j.created_at >= $1 AND j.created_at < $2
     GROUP BY 1
  ),
  mains AS (
    SELECT (h.created_at AT TIME ZONE $3)::date AS day, COUNT(DISTINCT h.job_id)::int AS n
      FROM video_generation_step_history h
     WHERE h.step = '${S.AwaitingOverlayApproval}'
       AND h.created_at >= $1 AND h.created_at < $2
     GROUP BY 1
  )
  SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
         COALESCE(s.n, 0)::int  AS new_users,
         COALESCE(st.n, 0)::int AS studio_users,
         COALESCE(sb.n, 0)::int AS submissions,
         COALESCE(m.n, 0)::int  AS main_videos
    FROM days d
    LEFT JOIN signups s  ON s.day  = d.day
    LEFT JOIN studio  st ON st.day = d.day
    LEFT JOIN subs    sb ON sb.day = d.day
    LEFT JOIN mains   m  ON m.day  = d.day
   ORDER BY d.day`;

/**
 * The pipeline points the studio goes through, in order, with who is waiting.
 * Legacy server-only steps (scene-by-scene approval, animations) are left out:
 * no studio request reaches them.
 */
export const PIPELINE_POINTS: { key: string; label: string; kind: "decision" | "ai" }[] = [
  { key: S.AnalyzingContent, label: "Writing the storyboard & script (AI)", kind: "ai" },
  { key: S.AwaitingContentApproval, label: "Storyboard & script waiting for the user", kind: "decision" },
  { key: S.GeneratingVoice, label: "Making the voice (AI)", kind: "ai" },
  { key: S.AwaitingVoiceApproval, label: "Voice waiting for the user", kind: "decision" },
  { key: S.GeneratingSceneDesign, label: "Designing the scenes (AI)", kind: "ai" },
  { key: S.AwaitingSceneDesignApproval, label: "Ready to render — waiting for Make the video", kind: "decision" },
  { key: S.GeneratingBaseVideo, label: "Rendering the picture (phone)", kind: "ai" },
  { key: S.ComposingFinalVideo, label: "Adding voice & music (phone)", kind: "ai" },
  { key: S.GeneratingOverlay, label: "Adding captions & look (phone)", kind: "ai" },
  { key: S.AwaitingOverlayApproval, label: "Main video waiting for the user", kind: "decision" },
  { key: S.GeneratingAdditionalRatios, label: "Making other channel shapes (phone)", kind: "ai" },
  { key: S.AwaitingDistributionReview, label: "Finished — waiting to download/send", kind: "decision" },
];

const PIPELINE_LABEL = new Map(PIPELINE_POINTS.map((point) => [point.key, point.label]));

/** A pipeline step as words, for failure lists. */
export function pipelineStepLabel(step: string): string {
  return PIPELINE_LABEL.get(step) ?? step.replace(/_/g, " ");
}

/** Assemble the per-step table from raw step and action rows. Pure; tested directly. */
export function buildStepRows(
  stepRows: Record<string, unknown>[],
  actionRows: Record<string, unknown>[]
): StepActivityRow[] {
  const byStep = new Map(stepRows.map((row) => [String(row.step), row]));
  const actions: ActionRow[] = actionRows
    .filter((row) => Object.prototype.hasOwnProperty.call(STUDIO_ACTIONS, String(row.action)))
    .map((row) => {
      const action = String(row.action) as StudioActionName;
      return {
        action,
        label: STUDIO_ACTIONS[action].label,
        count: toInt(row.count),
        users: toInt(row.users),
        requests: toInt(row.requests),
      };
    });
  return STUDIO_STEPS.map((step) => {
    const row = byStep.get(step);
    return {
      step,
      label: STUDIO_STEP_LABELS[step],
      users: toInt(row?.users),
      views: toInt(row?.views),
      visits: toInt(row?.visits),
      visitsEndedHere: toInt(row?.ended_here),
      medianSeconds: toNumberOrNull(row?.median_seconds),
      actions: actions
        .filter((action) => STUDIO_ACTIONS[action.action].step === step)
        .sort((a, b) => b.count - a.count),
    };
  });
}

export class AdminStudioActivityService {
  constructor(private db: QueryableDb = pool) {}

  async getReport(range: MetricsRange): Promise<StudioActivityReport> {
    const studio = await tableExists("studio_events", this.db);
    const bounds = [range.from, range.to];
    const tzBounds = [range.from, range.to, REPORTING_TIMEZONE];
    const q = (sql: string, values: unknown[]) => this.db.query(withStudio(sql, studio), values);

    const [
      stepRes,
      actionRes,
      studioTotalsRes,
      hoursRes,
      pipelineTotalsRes,
      durationRes,
      waitingRes,
      failuresRes,
      phoneRes,
      phoneErrorsRes,
      dailyRes,
    ] = await Promise.all([
      q(STEP_SQL, bounds),
      q(ACTION_SQL, bounds),
      q(STUDIO_TOTALS_SQL, bounds),
      q(HOURS_SQL, tzBounds),
      q(PIPELINE_TOTALS_SQL, bounds),
      q(STEP_DURATION_SQL, bounds),
      q(WAITING_NOW_SQL, []),
      q(PIPELINE_FAILURES_SQL, bounds),
      q(PHONE_RENDER_SQL, bounds),
      q(PHONE_ERRORS_SQL, bounds),
      q(DAILY_SQL, tzBounds),
    ]);

    const steps = buildStepRows(stepRes.rows, actionRes.rows);
    const durations = new Map(durationRes.rows.map((row) => [String(row.step), row]));
    const waiting = new Map(waitingRes.rows.map((row) => [String(row.step), toInt(row.waiting)]));
    const pipeline: PipelineStepRow[] = PIPELINE_POINTS.map((point) => {
      const row = durations.get(point.key);
      return {
        ...point,
        reached: toInt(row?.reached),
        medianSeconds: toNumberOrNull(row?.median_seconds),
        p90Seconds: toNumberOrNull(row?.p90_seconds),
        waitingNow: waiting.get(point.key) ?? 0,
      };
    });

    const phoneRenders: PhoneRenderRow[] = phoneRes.rows.map((row) => ({
      platform: String(row.platform),
      stage: String(row.stage),
      attempts: toInt(row.attempts),
      completed: toInt(row.completed),
      failed: toInt(row.failed),
      abandoned: toInt(row.abandoned),
      medianSeconds: toNumberOrNull(row.median_seconds),
    }));

    const totalsRow = pipelineTotalsRes.rows[0] ?? {};
    const studioRow = studioTotalsRes.rows[0] ?? {};
    const audio = steps.find((step) => step.step === "audio");
    const remakes = audio?.actions.find((a) => a.action === "voice_regenerated")?.count ?? 0;
    const voicesMade = audio?.actions.find((a) => a.action === "voice_ready")?.requests ?? 0;

    return {
      studioTracking: studio,
      totals: {
        newUsers: toInt(totalsRow.new_users),
        studioUsers: toInt(studioRow.users),
        studioVisits: toInt(studioRow.visits),
        briefsSaved: toInt(totalsRow.briefs),
        submissions: toInt(totalsRow.submissions),
        mainVideos: toInt(totalsRow.main_videos),
        finished: toInt(totalsRow.finished),
        phoneRendersOk: phoneRenders.reduce((sum, row) => sum + row.completed, 0),
        phoneRendersFailed: phoneRenders.reduce((sum, row) => sum + row.failed, 0),
      },
      steps,
      pipeline,
      pipelineFailures: failuresRes.rows.map((row) => ({
        label: pipelineStepLabel(String(row.step)),
        count: toInt(row.count),
      })),
      phoneRenders,
      phoneErrors: phoneErrorsRes.rows.map((row) => ({
        label: String(row.label),
        count: toInt(row.count),
      })),
      daily: dailyRes.rows.map((row) => ({
        date: String(row.date),
        newUsers: toInt(row.new_users),
        studioUsers: toInt(row.studio_users),
        submissions: toInt(row.submissions),
        mainVideos: toInt(row.main_videos),
      })),
      hours: hoursRes.rows.map((row) => ({
        dayOfWeek: toInt(row.dow),
        hour: toInt(row.hour),
        count: toInt(row.count),
      })),
      voiceRemakesPerRequest: voicesMade > 0 ? remakes / voicesMade : null,
    };
  }
}

export const adminStudioActivityService = new AdminStudioActivityService();
