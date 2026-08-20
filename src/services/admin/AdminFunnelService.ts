import { pool } from "@/lib/db";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import { tableExists } from "@/lib/db/tableExists";

/**
 * The nine-stage acquisition → Channel Management funnel.
 *
 * NO REPOSITORY ON PURPOSE. This service reads across nine tables that belong
 * to five different aggregates (users, clip requests, pipeline jobs, credits,
 * Channel Management) and produces no domain model — only counts. A repository
 * per table would mean nine singletons in `@/repositories` and a join layer in
 * TypeScript that Postgres does the better job of. `ManagementAuditService`,
 * `LoginEventService` and `AdminFeedbackService` all talk to the shared pool
 * directly for the same reason; the pool is constructor-injected so the tests
 * drive a stub instead of opening a socket.
 *
 * COHORT SEMANTICS. Stage 1 is "users who signed up inside the selected range";
 * stages 2–9 count how many of THOSE users have since reached each stage, at
 * any later date — not only inside the range. That choice is what makes the
 * funnel a funnel: if every stage were independently windowed, stage 3 would be
 * counting people who signed up months earlier and the "conversion" between two
 * stages would be a ratio between two unrelated populations. The cost is that
 * the most recent cohorts are always understated (a user who signed up
 * yesterday has not had time to pay), which is exactly why the per-week cohort
 * table exists beside the aggregate.
 *
 * Everything is `COUNT(DISTINCT user)`; the event count carried beside it is
 * secondary and is only ever shown in small text.
 */

/**
 * ID JOIN RULE: cast BOTH sides to text, never one.
 *
 * `clip_requests.id`, `video_generation_jobs.id` and `.request_id` are uuid in
 * some environments and text in others (migrations 006 and 019 inspect
 * `information_schema` for exactly this reason). Casting only one side looks
 * safe and is not: `cr.id::text = j.request_id` is `text = uuid` wherever
 * request_id is a uuid, and Postgres answers `operator does not exist` (42883)
 * — a runtime failure that no environment except the mismatched one will show.
 *
 * Both sides to text is the only form that holds in every environment. It gives
 * up index use on those joins; acceptable here because these are admin
 * analytics reports over small tables, not a request-path query.
 *
 * WHICH CASTS ARE ACTUALLY REMOVABLE, if these reports ever get slow:
 *
 *   - `video_generation_jobs.request_id` → `clip_requests.id` carries a FOREIGN
 *     KEY in production (`video_generation_jobs_request_id_fkey`). A FK cannot
 *     exist between mismatched types, so that pair is guaranteed to agree — both
 *     uuid in production, both text under the bare DDL. Those two casts are
 *     belt-and-braces and could be dropped to recover
 *     `idx_video_generation_jobs_request_id`.
 *   - Everything else genuinely mixes types and MUST stay cast:
 *     `video_generation_step_history.job_id`, `render_tasks.job_id`,
 *     `pipeline_gate_events.job_id` and `ai_content_reports.request_id` are all
 *     TEXT by their own DDL, while the ids they point at are uuid in production.
 *     There is no FK on any of them — deliberately, because the id type varies.
 *
 * Do not "simplify" the second group. That is the group that caused the outage.
 */
/** Stable keys, in funnel order. The page renders them in this order. */
export type FunnelStageKey =
  | "signed_up"
  | "logged_in"
  | "started_generation"
  | "reached_final_step"
  | "paid_for_generation"
  | "transferred_to_management"
  | "uploaded_to_management"
  | "paid_for_management"
  | "published";

export interface FunnelStageDefinition {
  key: FunnelStageKey;
  label: string;
  /** How the stage is counted — rendered under the bar, not in a tooltip. */
  hint: string;
}

/**
 * The stage list, with the counting rule attached to each one.
 *
 * The hint is part of the data, not decoration: "paid for video generation"
 * means `download_unlocked AND NOT is_trial_request`, and an admin comparing
 * this number against the payments page needs to know that before they file a
 * bug about the two disagreeing.
 */
export const FUNNEL_STAGES: FunnelStageDefinition[] = [
  {
    key: "signed_up",
    label: "Signed up",
    hint: "live accounts created in range",
  },
  {
    key: "logged_in",
    label: "Logged in",
    hint: "real sign-ins only; synthetic backfill rows excluded",
  },
  {
    key: "started_generation",
    label: "Started generating a video",
    hint: "request reached a pipeline job, not merely a draft",
  },
  {
    key: "reached_final_step",
    label: "Reached the final step",
    hint: "job history contains awaiting_distribution_review or complete",
  },
  {
    key: "paid_for_generation",
    label: "Paid for video generation",
    hint: "download unlocked on a non-trial request",
  },
  {
    key: "transferred_to_management",
    label: "Moved a video to Channel Management",
    hint: "generated video transferred into Management",
  },
  {
    key: "uploaded_to_management",
    label: "Uploaded own video to Channel Management",
    hint: "own file, no RClipper generation behind it",
  },
  {
    key: "paid_for_management",
    label: "Paid for Channel Management",
    hint: "purchase in status paid",
  },
  {
    key: "published",
    label: "Published through Channel Management",
    hint: "at least one destination reached status published",
  },
];

export interface FunnelStageCount extends FunnelStageDefinition {
  /** Distinct users. The headline number. */
  users: number;
  /** Events behind those users — always secondary. */
  events: number;
}

/** One signup week, with the same nine stages measured for that cohort alone. */
export interface FunnelCohortRow {
  /** Monday of the Bangkok signup week, `YYYY-MM-DD`. */
  week: string;
  /** Users per stage, in `FUNNEL_STAGES` order. */
  users: number[];
}

/**
 * A stage that came out larger than the one before it.
 *
 * `severity` exists because two of the eight pairs can widen WITHOUT anything
 * being broken, and a page that cried "join bug" at both would be ignored
 * within a week:
 *
 *   - 2 → 3: login tracking only exists from the day `user_login_events`
 *     shipped, so every pre-instrumentation cohort has a stage 2 that is
 *     structurally too small. Stage 3 exceeding it is the expected reading.
 *   - 6 → 7: transferring a generated video and uploading your own are
 *     independent entry paths into Channel Management, not a conversion.
 *
 * Everywhere else, a widening funnel is a defect.
 */
export interface FunnelWarning {
  /** 1-based stage numbers, as shown on the page. */
  fromStage: number;
  toStage: number;
  message: string;
  severity: "bug" | "known-gap";
}

export interface FunnelDrop {
  fromLabel: string;
  toLabel: string;
  /** Users lost between the two stages. */
  dropped: number;
  /** Share of the earlier stage that was lost, 0–100. */
  pct: number;
}

export interface FunnelReport {
  stages: FunnelStageCount[];
  cohorts: FunnelCohortRow[];
  /** Stage 1. Named separately because the tiles read it directly. */
  totalUsers: number;
  /** Stage 1 → stage 5, as a percentage. */
  overallConversionPct: number;
  /** Largest single stage-to-stage loss, or null when nobody signed up. */
  biggestDrop: FunnelDrop | null;
  /**
   * Distinct cohort users with a `request_charge` credit transaction. The
   * independent cross-check on stage 5: the two are computed from different
   * tables (the request flag vs the credit ledger) and should agree.
   */
  chargedUsers: number;
  /** Monotonicity violations, classified — see `FunnelWarning`. */
  warnings: FunnelWarning[];
}

/** Daily signups and distinct daily logins, for the trend chart. */
export interface SignupLoginPoint {
  /** `YYYY-MM-DD` in Bangkok. */
  date: string;
  signups: number;
  logins: number;
}

/**
 * When login instrumentation actually started producing data.
 *
 * Detected, never hardcoded: migration 028 shipped `user_login_events` with a
 * synthetic `provider = 'backfill'` seed derived from `users.created_at`, so
 * the earliest REAL row is the only honest answer to "from when is stage 2
 * meaningful", and it moves whenever the table is reseeded.
 */
export interface LoginInstrumentation {
  /**
   * Does `user_login_events` exist at all?
   *
   * False means migration 028 has not reached this database. The login stage is
   * then reported as unavailable rather than as zero — "nobody logged in" and
   * "we are not recording logins" are very different findings, and showing the
   * first while the second is true is a lie the funnel cannot recover from.
   */
  available: boolean;
  /** Earliest non-backfill sign-in, or null when none has been recorded yet. */
  firstRealLoginAt: Date | null;
  realLoginRows: number;
  backfillRows: number;
}

/**
 * A stand-in with `user_login_events`' shape and no rows.
 *
 * Substituted into the queries when that table is missing, so the funnel still
 * renders every other stage instead of taking the whole page down. One query,
 * one code path — the alternative is duplicating two large SQL statements.
 */
const EMPTY_LOGIN_SOURCE = `(SELECT NULL::uuid AS user_id,
                                    ''::text AS provider,
                                    NULL::timestamptz AS created_at
                              WHERE false)`;

/** Point the login CTEs at the real table, or at the empty stand-in. */
function loginSourceSql(sql: string, available: boolean): string {
  return available
    ? sql
    : sql.split("FROM user_login_events le").join(`FROM ${EMPTY_LOGIN_SOURCE} le`);
}

/**
 * Minimal shape of the `pg` pool this service needs, so tests can inject a stub
 * without constructing a real Pool (which would try to open a socket).
 */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * `pg` hands back `COUNT(*)`, `SUM()` and every NUMERIC/BIGINT as a STRING.
 * Every count below is already `::int` in SQL, but `SUM()` over an int column
 * is BIGINT and a driver upgrade could change what `::int` yields, so the
 * boundary parses defensively rather than trusting the type.
 */
function toInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * Per-stage user sets, as CTEs.
 *
 * Every set is `(user_id, events)` with AT MOST ONE ROW PER USER, so the nine
 * LEFT JOINs below cannot fan out and `COUNT(sN.user_id)` is a distinct-user
 * count by construction.
 *
 * ID-TYPE HAZARD. `clip_requests.id` and `video_generation_jobs.id` are TEXT in
 * the DDL but uuid in production, `clip_requests.user_id` is TEXT with no FK to
 * `users.id` (uuid), and `video_generation_step_history.job_id` is TEXT with no
 * FK. Every join across that boundary casts explicitly (migrations 006 and 019
 * set the precedent) — an uncast join runs fine in one environment and throws
 * `operator does not exist: uuid = text` in the other. The Management tables
 * and `user_login_events` reference `users(id)` with a real FK, so those joins
 * are uuid-to-uuid and are deliberately left uncast.
 *
 * SOFT DELETES. `users.deleted_at` is honoured: a deleted account is not part
 * of any cohort. `management_content_items.removed_at` is deliberately NOT
 * honoured — the user did transfer or upload that video, and un-counting the
 * stage because they later tidied the item away would rewrite history.
 */
const STAGE_SETS_SQL = `
  cohort AS (
    SELECT u.id AS user_id,
           date_trunc('week', u.created_at AT TIME ZONE $3)::date AS cohort_week
      FROM users u
     WHERE u.deleted_at IS NULL
       AND u.created_at >= $1
       AND u.created_at < $2
  ),
  s2 AS (
    -- Synthetic backfill rows were derived from users.created_at, so counting
    -- them would report a 100% login rate for every pre-instrumentation cohort.
    SELECT le.user_id, COUNT(*)::int AS events
      FROM user_login_events le
     WHERE le.provider <> 'backfill'
     GROUP BY le.user_id
  ),
  s3 AS (
    -- "Started generating" means a pipeline job exists. A draft request that
    -- never reached the pipeline is not a generation attempt.
    SELECT cr.user_id, COUNT(DISTINCT cr.id)::int AS events
      FROM clip_requests cr
      JOIN video_generation_jobs j ON j.request_id::text = cr.id::text
     GROUP BY cr.user_id
  ),
  s4 AS (
    SELECT cr.user_id, COUNT(DISTINCT h.job_id)::int AS events
      FROM video_generation_step_history h
      JOIN video_generation_jobs j ON j.id::text = h.job_id::text
      JOIN clip_requests cr ON cr.id::text = j.request_id::text
     WHERE h.step IN ('awaiting_distribution_review', 'complete')
     GROUP BY cr.user_id
  ),
  s5 AS (
    SELECT cr.user_id, COUNT(*)::int AS events
      FROM clip_requests cr
     WHERE cr.download_unlocked = true
       AND cr.is_trial_request = false
     GROUP BY cr.user_id
  ),
  s6 AS (
    SELECT m.user_id, COUNT(*)::int AS events
      FROM management_content_items m
     WHERE m.source_type = 'rclipper_generation'
       AND m.transferred_at IS NOT NULL
     GROUP BY m.user_id
  ),
  s7 AS (
    SELECT m.user_id, COUNT(*)::int AS events
      FROM management_content_items m
     WHERE m.source_type = 'user_upload'
     GROUP BY m.user_id
  ),
  s8 AS (
    SELECT p.user_id, COUNT(*)::int AS events
      FROM management_purchases p
     WHERE p.status = 'paid'
     GROUP BY p.user_id
  ),
  s9 AS (
    SELECT p.user_id, COUNT(DISTINCT t.id)::int AS events
      FROM management_publications p
      JOIN management_publication_targets t ON t.publication_id = p.id
     WHERE t.status = 'published'
     GROUP BY p.user_id
  ),
  charged AS (
    -- Cross-check on stage 5 from the other side of the transaction: the credit
    -- ledger rather than the request's download flag.
    SELECT ct.user_id, COUNT(*)::int AS events
      FROM credit_transactions ct
     WHERE ct.type = 'request_charge'
     GROUP BY ct.user_id
  )`;

/**
 * One query answers both the aggregate funnel and the cohort table.
 *
 * Grouping by signup week and summing the columns in TypeScript guarantees the
 * two views can never disagree — which they would, sooner or later, if the page
 * ran the funnel once over the range and again per week.
 */
const FUNNEL_BY_COHORT_SQL = `
  WITH${STAGE_SETS_SQL}
  SELECT
    to_char(c.cohort_week, 'YYYY-MM-DD')                AS cohort_week,
    COUNT(*)::int                                       AS s1_users,
    COUNT(*)::int                                       AS s1_events,
    COUNT(s2.user_id)::int                              AS s2_users,
    COALESCE(SUM(s2.events), 0)::int                    AS s2_events,
    COUNT(s3.user_id)::int                              AS s3_users,
    COALESCE(SUM(s3.events), 0)::int                    AS s3_events,
    COUNT(s4.user_id)::int                              AS s4_users,
    COALESCE(SUM(s4.events), 0)::int                    AS s4_events,
    COUNT(s5.user_id)::int                              AS s5_users,
    COALESCE(SUM(s5.events), 0)::int                    AS s5_events,
    COUNT(s6.user_id)::int                              AS s6_users,
    COALESCE(SUM(s6.events), 0)::int                    AS s6_events,
    COUNT(s7.user_id)::int                              AS s7_users,
    COALESCE(SUM(s7.events), 0)::int                    AS s7_events,
    COUNT(s8.user_id)::int                              AS s8_users,
    COALESCE(SUM(s8.events), 0)::int                    AS s8_events,
    COUNT(s9.user_id)::int                              AS s9_users,
    COALESCE(SUM(s9.events), 0)::int                    AS s9_events,
    COUNT(charged.user_id)::int                         AS charged_users
  FROM cohort c
  LEFT JOIN s2      ON s2.user_id::text      = c.user_id::text
  LEFT JOIN s3      ON s3.user_id::text      = c.user_id::text
  LEFT JOIN s4      ON s4.user_id::text      = c.user_id::text
  LEFT JOIN s5      ON s5.user_id::text      = c.user_id::text
  LEFT JOIN s6      ON s6.user_id::text      = c.user_id::text
  LEFT JOIN s7      ON s7.user_id::text      = c.user_id::text
  LEFT JOIN s8      ON s8.user_id::text      = c.user_id::text
  LEFT JOIN s9      ON s9.user_id::text      = c.user_id::text
  LEFT JOIN charged ON charged.user_id::text = c.user_id::text
  GROUP BY c.cohort_week
  ORDER BY c.cohort_week`;

/**
 * Daily signups and distinct daily logins.
 *
 * `generate_series` supplies every Bangkok day in range so the line has no gaps
 * — a day with no signups must plot as zero, not vanish and let the line
 * interpolate across it.
 */
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
       AND u.created_at >= $1
       AND u.created_at < $2
     GROUP BY 1
  ),
  logins AS (
    SELECT (le.created_at AT TIME ZONE $3)::date AS day,
           COUNT(DISTINCT le.user_id)::int AS n
      FROM user_login_events le
     WHERE le.provider <> 'backfill'
       AND le.created_at >= $1
       AND le.created_at < $2
     GROUP BY 1
  )
  SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
         COALESCE(s.n, 0)::int        AS signups,
         COALESCE(l.n, 0)::int        AS logins
    FROM days d
    LEFT JOIN signups s ON s.day = d.day
    LEFT JOIN logins  l ON l.day = d.day
   ORDER BY d.day`;

export class AdminFunnelService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * The whole page in one round trip: aggregate funnel, per-week cohorts, the
   * credit cross-check and the monotonicity warnings.
   */
  async getFunnelReport(from: Date, to: Date): Promise<FunnelReport> {
    const loginsAvailable = await tableExists("user_login_events", this.db);
    const { rows } = await this.db.query(loginSourceSql(FUNNEL_BY_COHORT_SQL, loginsAvailable), [
      from,
      to,
      REPORTING_TIMEZONE,
    ]);

    const cohorts: FunnelCohortRow[] = rows.map((row) => ({
      week: String(row.cohort_week),
      users: FUNNEL_STAGES.map((_, i) => toInt(row[`s${i + 1}_users`])),
    }));

    const stages: FunnelStageCount[] = FUNNEL_STAGES.map((stage, i) => ({
      ...stage,
      users: sumColumn(rows, `s${i + 1}_users`),
      events: sumColumn(rows, `s${i + 1}_events`),
    }));

    const totalUsers = stages[0]?.users ?? 0;
    const paidUsers = stages[4]?.users ?? 0;

    return {
      stages,
      cohorts,
      totalUsers,
      overallConversionPct: totalUsers > 0 ? (paidUsers / totalUsers) * 100 : 0,
      biggestDrop: findBiggestDrop(stages),
      chargedUsers: sumColumn(rows, "charged_users"),
      warnings: monotonicWarnings(stages),
    };
  }

  async getSignupLoginTrend(from: Date, to: Date): Promise<SignupLoginPoint[]> {
    const loginsAvailable = await tableExists("user_login_events", this.db);
    const { rows } = await this.db.query(loginSourceSql(SIGNUP_LOGIN_TREND_SQL, loginsAvailable), [
      from,
      to,
      REPORTING_TIMEZONE,
    ]);
    return rows.map((row) => ({
      date: String(row.date),
      signups: toInt(row.signups),
      logins: toInt(row.logins),
    }));
  }

  /**
   * When stage 2 started being real. Deliberately unfiltered by range: the page
   * needs the absolute first real sign-in to say "before this date, stage 2 is
   * structurally zero", and a range-scoped MIN would move with the picker and
   * mean nothing.
   */
  async getLoginInstrumentation(): Promise<LoginInstrumentation> {
    if (!(await tableExists("user_login_events", this.db))) {
      return { available: false, firstRealLoginAt: null, realLoginRows: 0, backfillRows: 0 };
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
    };
  }
}

/** Column-wise sum across the cohort rows, parsing each cell defensively. */
function sumColumn(rows: Record<string, unknown>[], column: string): number {
  return rows.reduce((total, row) => total + toInt(row[column]), 0);
}

/** Largest single stage-to-stage loss. Ties resolve to the earliest pair. */
export function findBiggestDrop(stages: FunnelStageCount[]): FunnelDrop | null {
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

/**
 * A funnel that widens is, almost always, a join bug rather than an insight.
 *
 * Every stage is measured over the SAME cohort of signed-up users, so no stage
 * can legitimately exceed the one before it: reaching the final step requires
 * having started, publishing requires content in Management. If a count grows,
 * the usual cause is a join that fanned out (a user matched several rows in a
 * set that was supposed to be one-row-per-user) or a cast that silently matched
 * the wrong column. The page shows these instead of drawing a bar wider than
 * its parent, which would read as a discovery rather than a defect.
 *
 * The two pairs that can widen honestly are classified as `known-gap` so the
 * page can present them as notes rather than as alarms — see `FunnelWarning`.
 * Without that split the red banner would be permanent for every window that
 * predates login instrumentation, and a permanent alarm is not an alarm.
 */
export function monotonicWarnings(stages: FunnelStageCount[]): FunnelWarning[] {
  const warnings: FunnelWarning[] = [];
  for (let i = 1; i < stages.length; i += 1) {
    const previous = stages[i - 1];
    const current = stages[i];
    if (current.users <= previous.users) continue;

    const preamble =
      `Stage ${i + 1} "${current.label}" (${current.users.toLocaleString()}) exceeds ` +
      `stage ${i} "${previous.label}" (${previous.users.toLocaleString()}).`;

    if (i === 2) {
      warnings.push({
        fromStage: i,
        toStage: i + 1,
        severity: "known-gap",
        message:
          `${preamble} Expected for any cohort that signed up before login tracking ` +
          `existed: those users generated videos, but their sign-ins were never recorded. ` +
          `It only indicates a bug for cohorts after the instrumentation date below.`,
      });
      continue;
    }

    if (i === 6) {
      warnings.push({
        fromStage: i,
        toStage: i + 1,
        severity: "known-gap",
        message:
          `${preamble} Stages 6 and 7 are independent entry paths into Channel ` +
          `Management, so this reads as users uploading their own videos without ` +
          `ever transferring a generated one — not as a broken join.`,
      });
      continue;
    }

    warnings.push({
      fromStage: i,
      toStage: i + 1,
      severity: "bug",
      message: `${preamble} A funnel cannot widen — check the join for that stage.`,
    });
  }
  return warnings;
}

export const adminFunnelService = new AdminFunnelService();
