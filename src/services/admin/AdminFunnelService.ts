import { pool } from "@/lib/db";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import { tableExists } from "@/lib/db/tableExists";
import { VideoGenerationStep as S } from "@/domain/enums/VideoGenerationStep";
import { toDateOrNull, toInt } from "@/services/admin/analyticsShared";
import { pipelineStepLabel } from "@/services/admin/AdminStudioActivityService";

/**
 * The new-user funnel, following the studio journey (Oct 2026).
 *
 * The studio is now the one way to make a video, and there is no staff or
 * admin approval anywhere in it: every gate is the requester's own button.
 * The old nine-stage funnel (paid generation, paid Channel Management…) was
 * built for the server pipeline and the per-request paywall, both gone. This
 * one follows a new user from signing up, through each studio milestone, to
 * taking the finished videos out and publishing them — and, for everyone who
 * did not get to the end, says WHERE they stopped and what was in their way.
 *
 * FURTHEST-STAGE RULE. The studio's milestones happen in a fixed order (no
 * voice before a script, no render before the voice is approved), so every
 * user is placed at the furthest milestone there is evidence for, and each
 * stage counts the users who reached AT LEAST that far. Later evidence implies
 * the earlier stages: someone with a finished video did sign in and did open
 * the studio, even if they did it before login tracking (migration 028) or
 * studio tracking (migration 041) existed. That is what makes the funnel
 * retroactive and monotonic by construction. The "recorded" count beside each
 * stage is the direct evidence alone, so a tracking gap stays visible.
 *
 * COHORT BASIS. Stage 1 is the users who signed up inside the range; the other
 * stages count those same users at any later date. Recent cohorts are always
 * understated — they have had the least time.
 *
 * NO REPOSITORY ON PURPOSE: a read across a dozen tables that produces only
 * counts (same reasoning as before; the pool is injected for tests).
 *
 * ID JOIN RULE: both sides cast to text. `clip_requests.id`,
 * `video_generation_jobs.id/.request_id` are uuid in production and text under
 * the bare DDL; `clip_requests.user_id` and `video_allowance_windows.user_id`
 * are TEXT while `users.id` is uuid. Casting one side only fails at runtime in
 * exactly one environment (42883). Every user id below is `::text`.
 */

export type FunnelStageKey =
  | "signed_up"
  | "signed_in"
  | "opened_studio"
  | "wrote_brief"
  | "submitted_media"
  | "storyboard_ready"
  | "script_approved"
  | "voice_ready"
  | "voice_approved"
  | "render_started"
  | "main_video_made"
  | "videos_finished"
  | "took_videos_out"
  | "published";

export interface FunnelStageDefinition {
  key: FunnelStageKey;
  label: string;
  /** Short form for the cohort table header. */
  short: string;
  /** Which studio screen this happens on, for the reader. */
  where: string;
  /** How the direct evidence is counted. */
  hint: string;
}

/** In journey order. Index + 1 is the stage number shown on the page. */
export const FUNNEL_STAGES: FunnelStageDefinition[] = [
  {
    key: "signed_up",
    label: "Signed up",
    short: "Signed up",
    where: "Account",
    hint: "live, non-admin accounts created in range",
  },
  {
    key: "signed_in",
    label: "Signed in",
    short: "Signed in",
    where: "Account",
    hint: "a real sign-in (user_login_events, backfill rows excluded)",
  },
  {
    key: "opened_studio",
    label: "Opened the studio",
    short: "Studio",
    where: "Brief",
    hint: "studio_open event (studio_events, migration 041)",
  },
  {
    key: "wrote_brief",
    label: "Saved a brief",
    short: "Brief",
    where: "Brief",
    hint: "a request exists (Draft or later)",
  },
  {
    key: "submitted_media",
    label: "Submitted photos/clips",
    short: "Submitted",
    where: "Photos & clips",
    hint: "the request reached a pipeline job",
  },
  {
    key: "storyboard_ready",
    label: "Storyboard ready",
    short: "Storyboard",
    where: "Storyboard",
    hint: "job reached awaiting_content_approval",
  },
  {
    key: "script_approved",
    label: "Approved storyboard & script",
    short: "Script OK",
    where: "Storyboard → Sound",
    hint: "job reached generating_voice (start-production)",
  },
  {
    key: "voice_ready",
    label: "Voice ready",
    short: "Voice",
    where: "Sound",
    hint: "job reached awaiting_voice_approval",
  },
  {
    key: "voice_approved",
    label: "Approved the voice",
    short: "Voice OK",
    where: "Sound → Graphic",
    hint: "job reached generating_scene_design / awaiting_scene_design_approval",
  },
  {
    key: "render_started",
    label: "Pressed Make the video",
    short: "Render",
    where: "Render",
    hint: "job reached generating_base_video, or a phone render attempt exists",
  },
  {
    key: "main_video_made",
    label: "Main video made",
    short: "Main video",
    where: "Render",
    hint: "job reached awaiting_overlay_approval",
  },
  {
    key: "videos_finished",
    label: "Took the video (channels made)",
    short: "Finished",
    where: "Channels",
    hint: "job reached additional ratios, distribution review or complete",
  },
  {
    key: "took_videos_out",
    label: "Downloaded or sent to Channel Management",
    short: "Took out",
    where: "Channels",
    hint: "generated video transferred into Management, or a download event",
  },
  {
    key: "published",
    label: "Published a generated video",
    short: "Published",
    where: "Channel Management",
    hint: "a destination of a generated video reached status published",
  },
];

/** Pipeline steps that are direct evidence for each stage (index into FUNNEL_STAGES). */
const STEP_EVIDENCE: Partial<Record<FunnelStageKey, string[]>> = {
  storyboard_ready: [S.AwaitingContentApproval],
  script_approved: [S.GeneratingVoice],
  voice_ready: [S.AwaitingVoiceApproval],
  voice_approved: [S.GeneratingSceneDesign, S.AwaitingSceneDesignApproval],
  render_started: [S.GeneratingBaseVideo, S.MergingScenes, S.ComposingFinalVideo, S.GeneratingOverlay],
  main_video_made: [S.AwaitingOverlayApproval, S.AwaitingFinalApproval],
  videos_finished: [
    S.AwaitingAdditionalRatios,
    S.GeneratingAdditionalRatios,
    S.AwaitingDistributionReview,
    S.Publishing,
    S.Complete,
  ],
};

export interface FunnelStageCount extends FunnelStageDefinition {
  /** Users who reached at least this stage. The headline number. */
  users: number;
  /** Users with direct evidence for this stage (no implication). */
  recorded: number;
}

export interface FunnelCohortRow {
  /** Monday of the Bangkok signup week. */
  week: string;
  /** Users reaching at least each stage, in FUNNEL_STAGES order. */
  users: number[];
}

/** The users whose furthest stage is this one: they did it and went no further. */
export interface StopPoint {
  stageIndex: number;
  /** The stage they reached. */
  reachedLabel: string;
  /** The stage they did not reach (null for the last stage — that is finishing). */
  nextLabel: string | null;
  users: number;
  /** Share of the cohort, 0–100. */
  pct: number;
  /** Median days since their last activity. */
  medianIdleDays: number | null;
  /** Of these, how many are still active (any activity in the last 3 days). */
  activeRecently: number;
  /** Of these, how many hit the free-video limit. */
  quotaBlocked: number;
  /** Of these, how many have a failed job. */
  failed: number;
  /** Most common failure steps / phone render errors among them. */
  topProblems: { label: string; users: number }[];
}

export interface StuckUser {
  email: string;
  signedUpAt: Date;
  stageLabel: string;
  nextLabel: string | null;
  lastActiveAt: Date | null;
  problem: string | null;
}

export interface FunnelDrop {
  fromLabel: string;
  toLabel: string;
  dropped: number;
  pct: number;
}

export interface FunnelSideMetrics {
  /** Bought a video package (video_allowance_windows). */
  boughtPackage: number;
  /** Of those, how many also reached "Main video made". */
  boughtAndMadeVideo: number;
  /** Uploaded their own video into Channel Management. */
  uploadedOwn: number;
  /** Hit the free-video limit at least once (studio event). */
  quotaBlocked: number;
}

export interface FunnelReport {
  stages: FunnelStageCount[];
  cohorts: FunnelCohortRow[];
  totalUsers: number;
  /** Signed up → main video made, %. */
  madeVideoPct: number;
  /** Signed up → took videos out, %. */
  tookOutPct: number;
  biggestDrop: FunnelDrop | null;
  stopPoints: StopPoint[];
  stuckUsers: StuckUser[];
  side: FunnelSideMetrics;
  /** Is studio_events present? Without it stage 3 is implied only. */
  studioTracking: boolean;
}

export interface SignupLoginPoint {
  date: string;
  signups: number;
  logins: number;
  /** Distinct users active in the studio that day (events or a request touched). */
  studioUsers: number;
}

export interface LoginInstrumentation {
  available: boolean;
  firstRealLoginAt: Date | null;
  realLoginRows: number;
  backfillRows: number;
  /** First studio event on record (migration 041), or null. */
  firstStudioEventAt: Date | null;
}

interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Stand-ins with the right shape and no rows, for tables a migration has not created. */
const EMPTY_LOGINS = `(SELECT NULL::uuid AS user_id, ''::text AS provider,
                              NULL::timestamptz AS created_at WHERE false)`;
const EMPTY_STUDIO = `(SELECT NULL::uuid AS user_id, ''::text AS kind, ''::text AS action,
                              ''::text AS session_id, ''::text AS step,
                              NULL::timestamptz AS occurred_at WHERE false)`;

function withSources(sql: string, logins: boolean, studio: boolean): string {
  let out = sql;
  if (!logins) out = out.split("FROM user_login_events le").join(`FROM ${EMPTY_LOGINS} le`);
  if (!studio) out = out.split("FROM studio_events se").join(`FROM ${EMPTY_STUDIO} se`);
  return out;
}

const stepList = (steps: string[]) => steps.map((step) => `'${step}'`).join(", ");

/**
 * One row per cohort user, with the evidence for every stage and the context
 * needed to explain a stop. Small: it is only the users who signed up in range.
 */
const PER_USER_SQL = `
  WITH cohort AS (
    SELECT u.id::text AS uid,
           u.email,
           u.created_at,
           to_char(date_trunc('week', u.created_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS cohort_week
      FROM users u
     WHERE u.deleted_at IS NULL
       AND COALESCE(u.role, 'requester') <> 'admin'
       AND u.created_at >= $1
       AND u.created_at < $2
  ),
  logins AS (
    SELECT le.user_id::text AS uid, MAX(le.created_at) AS last_at
      FROM user_login_events le
     WHERE le.provider <> 'backfill'
     GROUP BY le.user_id
  ),
  studio AS (
    SELECT se.user_id::text AS uid,
           BOOL_OR(se.kind = 'studio_open')                                    AS opened,
           BOOL_OR(se.action = 'quota_blocked')                                AS quota_blocked,
           BOOL_OR(se.action IN ('video_downloaded', 'sent_to_management'))    AS took_out,
           MAX(se.occurred_at)                                                 AS last_at
      FROM studio_events se
     GROUP BY se.user_id
  ),
  reqs AS (
    SELECT cr.user_id::text AS uid, COUNT(*)::int AS requests, MAX(cr.updated_at) AS last_at
      FROM clip_requests cr
     GROUP BY cr.user_id
  ),
  jobs AS (
    SELECT cr.user_id::text AS uid, j.id::text AS job_id, j.current_step, j.failed_at_step,
           j.updated_at
      FROM video_generation_jobs j
      JOIN clip_requests cr ON cr.id::text = j.request_id::text
  ),
  steps AS (
    -- Every step a user's jobs have been on: history plus where they are now
    -- (the current step is evidence even if a history row was never written).
    SELECT jb.uid, h.step
      FROM video_generation_step_history h
      JOIN jobs jb ON jb.job_id::text = h.job_id::text
    UNION
    SELECT jb.uid, jb.current_step FROM jobs jb
  ),
  step_flags AS (
    SELECT uid,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.storyboard_ready!)}))  AS storyboard_ready,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.script_approved!)}))   AS script_approved,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.voice_ready!)}))       AS voice_ready,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.voice_approved!)}))    AS voice_approved,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.render_started!)}))    AS render_started,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.main_video_made!)}))   AS main_video_made,
           BOOL_OR(step IN (${stepList(STEP_EVIDENCE.videos_finished!)}))   AS videos_finished
      FROM steps
     GROUP BY uid
  ),
  job_summary AS (
    SELECT uid,
           COUNT(*)::int AS jobs,
           MAX(updated_at) AS last_at,
           -- The latest job's failure, if it is failed now.
           (ARRAY_AGG(CASE WHEN current_step = '${S.Failed}' THEN COALESCE(failed_at_step, 'unknown') END
                      ORDER BY updated_at DESC))[1] AS failed_step
      FROM jobs
     GROUP BY uid
  ),
  phone AS (
    SELECT a.requester_id::text AS uid,
           COUNT(*)::int AS attempts,
           COUNT(*) FILTER (WHERE a.state = 'completed')::int AS completed,
           (ARRAY_AGG(a.stage || ': ' || LEFT(COALESCE(a.error, 'no reason'), 80) ORDER BY a.created_at DESC)
              FILTER (WHERE a.state = 'failed'))[1] AS last_error,
           MAX(a.updated_at) AS last_at
      FROM device_render_attempts a
     GROUP BY a.requester_id
  ),
  mgmt AS (
    SELECT m.user_id::text AS uid,
           BOOL_OR(m.source_type = 'rclipper_generation' AND m.transferred_at IS NOT NULL) AS transferred,
           BOOL_OR(m.source_type = 'user_upload') AS uploaded_own
      FROM management_content_items m
     GROUP BY m.user_id
  ),
  published AS (
    SELECT DISTINCT p.user_id::text AS uid
      FROM management_publications p
      JOIN management_publication_targets t ON t.publication_id = p.id
      JOIN management_content_items m ON m.id = p.management_content_id
     WHERE t.status = 'published'
       AND m.source_type = 'rclipper_generation'
  ),
  packages AS (
    SELECT DISTINCT w.user_id::text AS uid
      FROM video_allowance_windows w
     WHERE w.status <> 'revoked'
  )
  SELECT c.uid,
         c.email,
         c.created_at,
         c.cohort_week,
         (l.uid IS NOT NULL)                         AS signed_in,
         COALESCE(st.opened, false)                  AS opened_studio,
         (r.uid IS NOT NULL)                         AS wrote_brief,
         (js.uid IS NOT NULL)                        AS submitted_media,
         COALESCE(sf.storyboard_ready, false)        AS storyboard_ready,
         COALESCE(sf.script_approved, false)         AS script_approved,
         COALESCE(sf.voice_ready, false)             AS voice_ready,
         COALESCE(sf.voice_approved, false)          AS voice_approved,
         (COALESCE(sf.render_started, false) OR COALESCE(ph.attempts, 0) > 0) AS render_started,
         COALESCE(sf.main_video_made, false)         AS main_video_made,
         COALESCE(sf.videos_finished, false)         AS videos_finished,
         (COALESCE(mg.transferred, false) OR COALESCE(st.took_out, false))    AS took_videos_out,
         (pb.uid IS NOT NULL)                        AS published,
         COALESCE(st.quota_blocked, false)           AS quota_blocked,
         (pk.uid IS NOT NULL)                        AS bought_package,
         COALESCE(mg.uploaded_own, false)            AS uploaded_own,
         js.failed_step,
         ph.last_error                               AS phone_error,
         GREATEST(l.last_at, st.last_at, r.last_at, js.last_at, ph.last_at, c.created_at) AS last_active_at
    FROM cohort c
    LEFT JOIN logins      l  ON l.uid  = c.uid
    LEFT JOIN studio      st ON st.uid = c.uid
    LEFT JOIN reqs        r  ON r.uid  = c.uid
    LEFT JOIN job_summary js ON js.uid = c.uid
    LEFT JOIN step_flags  sf ON sf.uid = c.uid
    LEFT JOIN phone       ph ON ph.uid = c.uid
    LEFT JOIN mgmt        mg ON mg.uid = c.uid
    LEFT JOIN published   pb ON pb.uid = c.uid
    LEFT JOIN packages    pk ON pk.uid = c.uid
   ORDER BY c.created_at`;

const SIGNUP_LOGIN_TREND_SQL = `
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
     WHERE u.deleted_at IS NULL
       AND COALESCE(u.role, 'requester') <> 'admin'
       AND u.created_at >= $1 AND u.created_at < $2
     GROUP BY 1
  ),
  logins AS (
    SELECT (le.created_at AT TIME ZONE $3)::date AS day, COUNT(DISTINCT le.user_id)::int AS n
      FROM user_login_events le
     WHERE le.provider <> 'backfill'
       AND le.created_at >= $1 AND le.created_at < $2
     GROUP BY 1
  ),
  studio AS (
    SELECT day, COUNT(DISTINCT uid)::int AS n FROM (
      SELECT (se.occurred_at AT TIME ZONE $3)::date AS day, se.user_id::text AS uid
        FROM studio_events se
       WHERE se.occurred_at >= $1 AND se.occurred_at < $2
      UNION ALL
      SELECT (cr.updated_at AT TIME ZONE $3)::date, cr.user_id::text
        FROM clip_requests cr
       WHERE cr.updated_at >= $1 AND cr.updated_at < $2
    ) active
    GROUP BY day
  )
  SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
         COALESCE(s.n, 0)::int  AS signups,
         COALESCE(l.n, 0)::int  AS logins,
         COALESCE(st.n, 0)::int AS studio_users
    FROM days d
    LEFT JOIN signups s  ON s.day  = d.day
    LEFT JOIN logins  l  ON l.day  = d.day
    LEFT JOIN studio  st ON st.day = d.day
   ORDER BY d.day`;

/** The evidence columns of PER_USER_SQL, in FUNNEL_STAGES order (stage 1 is the cohort itself). */
const EVIDENCE_COLUMNS: (FunnelStageKey | null)[] = FUNNEL_STAGES.map((stage, i) =>
  i === 0 ? null : stage.key
);

/** One cohort user as the report needs it. */
export interface FunnelUserRow {
  email: string;
  signedUpAt: Date;
  week: string;
  /** Direct evidence per stage, FUNNEL_STAGES order; index 0 is always true. */
  evidence: boolean[];
  /** Furthest stage index with evidence. */
  furthest: number;
  quotaBlocked: boolean;
  boughtPackage: boolean;
  uploadedOwn: boolean;
  failedStep: string | null;
  phoneError: string | null;
  lastActiveAt: Date | null;
}

export function toFunnelUserRow(row: Record<string, unknown>): FunnelUserRow {
  const evidence = EVIDENCE_COLUMNS.map((column) => (column ? row[column] === true : true));
  let furthest = 0;
  evidence.forEach((has, i) => {
    if (has) furthest = i;
  });
  return {
    email: String(row.email ?? ""),
    signedUpAt: toDateOrNull(row.created_at) ?? new Date(0),
    week: String(row.cohort_week ?? ""),
    evidence,
    furthest,
    quotaBlocked: row.quota_blocked === true,
    boughtPackage: row.bought_package === true,
    uploadedOwn: row.uploaded_own === true,
    failedStep: row.failed_step ? String(row.failed_step) : null,
    phoneError: row.phone_error ? String(row.phone_error) : null,
    lastActiveAt: toDateOrNull(row.last_active_at),
  };
}

const DAY_MS = 86_400_000;
const ACTIVE_RECENTLY_DAYS = 3;

/** What most likely stopped this user, in words an admin can act on. */
export function problemFor(user: FunnelUserRow): string | null {
  if (user.failedStep) return `Video failed during: ${pipelineStepLabel(user.failedStep)}`;
  const nextKey = FUNNEL_STAGES[user.furthest + 1]?.key;
  if (user.phoneError && (nextKey === "main_video_made" || nextKey === "render_started")) {
    return `Phone render error — ${user.phoneError}`;
  }
  if (user.quotaBlocked && user.furthest < 4) return "Hit the free-video limit";
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Build the whole report from per-user rows. Pure, so it is tested directly. */
export function buildFunnelReport(
  users: FunnelUserRow[],
  options: { now?: Date; studioTracking: boolean }
): FunnelReport {
  const now = options.now ?? new Date();
  const total = users.length;

  const stages: FunnelStageCount[] = FUNNEL_STAGES.map((stage, i) => ({
    ...stage,
    users: users.filter((user) => user.furthest >= i).length,
    recorded: users.filter((user) => user.evidence[i]).length,
  }));

  const weeks = [...new Set(users.map((user) => user.week))].sort();
  const cohorts: FunnelCohortRow[] = weeks.map((week) => {
    const inWeek = users.filter((user) => user.week === week);
    return {
      week,
      users: FUNNEL_STAGES.map((_, i) => inWeek.filter((user) => user.furthest >= i).length),
    };
  });

  const stopPoints: StopPoint[] = FUNNEL_STAGES.map((stage, i) => {
    const here = users.filter((user) => user.furthest === i);
    const idle = here
      .filter((user) => user.lastActiveAt)
      .map((user) => (now.getTime() - (user.lastActiveAt as Date).getTime()) / DAY_MS);
    const problems = new Map<string, number>();
    for (const user of here) {
      const problem = problemFor(user);
      if (problem) problems.set(problem, (problems.get(problem) ?? 0) + 1);
    }
    return {
      stageIndex: i,
      reachedLabel: stage.label,
      nextLabel: FUNNEL_STAGES[i + 1]?.label ?? null,
      users: here.length,
      pct: total > 0 ? (here.length / total) * 100 : 0,
      medianIdleDays: median(idle),
      activeRecently: idle.filter((days) => days <= ACTIVE_RECENTLY_DAYS).length,
      quotaBlocked: here.filter((user) => user.quotaBlocked).length,
      failed: here.filter((user) => user.failedStep).length,
      topProblems: [...problems.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, count]) => ({ label, users: count })),
    };
  });

  const last = FUNNEL_STAGES.length - 1;
  const stuckUsers: StuckUser[] = users
    .filter((user) => user.furthest < last)
    .sort(
      (a, b) =>
        (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0)
    )
    .slice(0, 30)
    .map((user) => ({
      email: user.email,
      signedUpAt: user.signedUpAt,
      stageLabel: FUNNEL_STAGES[user.furthest].label,
      nextLabel: FUNNEL_STAGES[user.furthest + 1]?.label ?? null,
      lastActiveAt: user.lastActiveAt,
      problem: problemFor(user),
    }));

  const mainVideoIndex = FUNNEL_STAGES.findIndex((stage) => stage.key === "main_video_made");
  const tookOutIndex = FUNNEL_STAGES.findIndex((stage) => stage.key === "took_videos_out");

  return {
    stages,
    cohorts,
    totalUsers: total,
    madeVideoPct: total > 0 ? (stages[mainVideoIndex].users / total) * 100 : 0,
    tookOutPct: total > 0 ? (stages[tookOutIndex].users / total) * 100 : 0,
    biggestDrop: findBiggestDrop(stages),
    stopPoints,
    stuckUsers,
    side: {
      boughtPackage: users.filter((user) => user.boughtPackage).length,
      boughtAndMadeVideo: users.filter(
        (user) => user.boughtPackage && user.furthest >= mainVideoIndex
      ).length,
      uploadedOwn: users.filter((user) => user.uploadedOwn).length,
      quotaBlocked: users.filter((user) => user.quotaBlocked).length,
    },
    studioTracking: options.studioTracking,
  };
}

/** Largest single stage-to-stage loss. Ties resolve to the earliest pair. */
export function findBiggestDrop(stages: { label: string; users: number }[]): FunnelDrop | null {
  let worst: FunnelDrop | null = null;
  for (let i = 1; i < stages.length; i += 1) {
    const previous = stages[i - 1];
    const current = stages[i];
    const dropped = previous.users - current.users;
    if (dropped <= 0) continue;
    if (worst && dropped <= worst.dropped) continue;
    worst = {
      fromLabel: previous.label,
      toLabel: current.label,
      dropped,
      pct: previous.users > 0 ? (dropped / previous.users) * 100 : 0,
    };
  }
  return worst;
}

export class AdminFunnelService {
  constructor(private db: QueryableDb = pool) {}

  private async sources(): Promise<{ logins: boolean; studio: boolean }> {
    const [logins, studio] = await Promise.all([
      tableExists("user_login_events", this.db),
      tableExists("studio_events", this.db),
    ]);
    return { logins, studio };
  }

  async getFunnelReport(from: Date, to: Date, now: Date = new Date()): Promise<FunnelReport> {
    const { logins, studio } = await this.sources();
    const { rows } = await this.db.query(withSources(PER_USER_SQL, logins, studio), [
      from,
      to,
      REPORTING_TIMEZONE,
    ]);
    return buildFunnelReport(rows.map(toFunnelUserRow), { now, studioTracking: studio });
  }

  async getSignupLoginTrend(from: Date, to: Date): Promise<SignupLoginPoint[]> {
    const { logins, studio } = await this.sources();
    const { rows } = await this.db.query(withSources(SIGNUP_LOGIN_TREND_SQL, logins, studio), [
      from,
      to,
      REPORTING_TIMEZONE,
    ]);
    return rows.map((row) => ({
      date: String(row.date),
      signups: toInt(row.signups),
      logins: toInt(row.logins),
      studioUsers: toInt(row.studio_users),
    }));
  }

  /** When login and studio tracking started producing data (unfiltered by range). */
  async getLoginInstrumentation(): Promise<LoginInstrumentation> {
    const { logins, studio } = await this.sources();
    let firstStudioEventAt: Date | null = null;
    if (studio) {
      const { rows } = await this.db.query(`SELECT MIN(occurred_at) AS first_at FROM studio_events`);
      firstStudioEventAt = toDateOrNull(rows[0]?.first_at);
    }
    if (!logins) {
      return {
        available: false,
        firstRealLoginAt: null,
        realLoginRows: 0,
        backfillRows: 0,
        firstStudioEventAt,
      };
    }
    const { rows } = await this.db.query(
      `SELECT MIN(created_at) FILTER (WHERE provider <> 'backfill') AS first_real_login,
              COUNT(*) FILTER (WHERE provider <> 'backfill')::int   AS real_rows,
              COUNT(*) FILTER (WHERE provider = 'backfill')::int    AS backfill_rows
         FROM user_login_events`
    );
    const row = rows[0] ?? {};
    return {
      available: true,
      firstRealLoginAt: toDateOrNull(row.first_real_login),
      realLoginRows: toInt(row.real_rows),
      backfillRows: toInt(row.backfill_rows),
      firstStudioEventAt,
    };
  }
}

export const adminFunnelService = new AdminFunnelService();
