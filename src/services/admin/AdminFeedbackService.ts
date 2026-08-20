import { pool } from "@/lib/db";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import { ApiNotFoundError, ApiValidationError } from "@/lib/api/adminResponse";

/**
 * Read + triage side of `ai_content_reports` (schema.sql, triage columns from
 * migration 028).
 *
 * The table was WRITE-ONLY until this service existed: the single INSERT in
 * `api/requests/[id]/report-ai-content` had no counterpart anywhere — no query,
 * no repository, no screen. Real users have been rating their videos and
 * reporting unsafe output into a table nobody could open, and `status` /
 * `resolved_at` have been sitting at their defaults since the column was
 * created because no code ever wrote them.
 *
 * NO REPOSITORY ON PURPOSE. Nothing else reads this table, the rows are not a
 * domain model, and a repository would mean registering another singleton in
 * `@/repositories`. `PushNotificationService`, `ManagementAuditService` and
 * `MobileStorePurchaseService` all talk to their own table through the shared
 * pool for the same reason.
 *
 * The pool is constructor-injected (the `ManagementAuditService` /
 * `GateEventService` pattern) so the tests can drive it with a stub instead of
 * opening a socket.
 */

/** `report_type` — the two products sharing one table. */
export type FeedbackReportType = "feedback" | "safety";

/** `status` — the triage lifecycle. */
export type FeedbackReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

/**
 * `reason` values, split by the type they belong to.
 *
 * The CHECK constraint accepts all sixteen for either type — the pairing is
 * enforced in application code only (the submit route's `superRefine`), so a
 * row written by an older client, or by hand, can in principle be mismatched.
 * Everything here treats the pairing as advisory and never drops a row for
 * violating it.
 */
export const SAFETY_REASONS = [
  "unsafe",
  "sexual",
  "violent",
  "hate",
  "privacy",
  "impersonation",
  "copyright",
  "misleading",
  "other",
] as const;

export const FEEDBACK_REASONS = [
  "video_quality",
  "scene_selection",
  "motion_direction",
  "audio_music",
  "subtitles",
  "aspect_ratio",
  "other_feedback",
] as const;

export type SafetyReason = (typeof SAFETY_REASONS)[number];
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
export type ReportReason = SafetyReason | FeedbackReason;

/** The reasons the submit UI offers for a given type. */
export function reasonsForType(reportType: FeedbackReportType): readonly ReportReason[] {
  return reportType === "feedback" ? FEEDBACK_REASONS : SAFETY_REASONS;
}

/** Does this reason belong to this report type? Advisory — see the note above. */
export function isReasonForType(
  reportType: FeedbackReportType,
  reason: string
): boolean {
  return (reasonsForType(reportType) as readonly string[]).includes(reason);
}

/**
 * Which statuses each triage action may be applied to.
 *
 * `resolve` and `dismiss` deliberately accept `open` as well as `reviewing`: an
 * admin who reads a one-line report and fixes it on the spot should not have to
 * click "Accept for review" first purely to satisfy a state machine.
 */
export const TRIAGE_TRANSITIONS = {
  review: ["open"],
  resolve: ["open", "reviewing"],
  dismiss: ["open", "reviewing"],
} as const satisfies Record<string, readonly FeedbackReportStatus[]>;

/**
 * Triage failures, as domain errors (the `UploadValidationError` /
 * `PublicationActionError` convention).
 *
 * They extend the two `adminResponse` error types so `apiErrorResponse` answers
 * 404 and 400 respectively without every route handler having to re-map them —
 * the message is the whole point of these errors, and a plain `Error` would be
 * swallowed as an opaque 500 "Internal error".
 */
export class FeedbackReportNotFoundError extends ApiNotFoundError {
  constructor(id: string) {
    super(`Report ${id} not found.`);
    this.name = "FeedbackReportNotFoundError";
  }
}

export class FeedbackTransitionError extends ApiValidationError {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackTransitionError";
  }
}

export interface FeedbackReport {
  id: string;
  userId: string;
  /**
   * TEXT, no foreign key — `clip_requests.id` is uuid in production and text in
   * the DDL, so the column could not carry an FK. May point at a deleted request.
   */
  requestId: string;
  reportType: FeedbackReportType;
  reason: string;
  /** 1–5, and only ever set when `report_type = 'feedback'`. */
  rating: number | null;
  details: string | null;
  status: FeedbackReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  reviewedBy: string | null;
  reviewStartedAt: Date | null;
  resolutionNote: string | null;
  updatedAt: Date | null;
  /** NULL when the reporter's account was deleted (see `reporterDeleted`). */
  reporterEmail: string | null;
  reporterName: string | null;
  /** The account was anonymised in place; the report itself is still real. */
  reporterDeleted: boolean;
  /** NULL when the request has since been deleted. */
  requestTitle: string | null;
}

export interface ListReportsOptions {
  reportType?: FeedbackReportType;
  /** Omit (or pass "all") for every status. */
  status?: FeedbackReportStatus | "all";
  reason?: string;
  /** Feedback tab only: "show me everything rated N stars or worse/better". */
  minRating?: number;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface FeedbackSummary {
  /** Every status key present, zero-filled — the tiles must not render blanks. */
  byStatus: Record<FeedbackReportStatus, number>;
  byReason: { reason: string; count: number }[];
  /** NULL when nothing in range carried a rating (the safety tab, typically). */
  averageRating: number | null;
  ratedCount: number;
  total: number;
  /** One point per Bangkok day that had at least one rating. */
  ratingTrend: { date: string; averageRating: number; count: number }[];
}

/**
 * Minimal shape of the `pg` pool this service needs, so tests can inject a stub
 * without constructing a real Pool.
 */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Ids arrive from a URL path segment. Postgres answers a non-uuid with
 * `invalid input syntax for type uuid`, which `apiErrorResponse` would turn
 * into an opaque 500; checking here makes it the 404-ish error it actually is.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Columns every read returns, so the row mapper has one shape to expect. */
const REPORT_COLUMNS = `
        ar.id,
        ar.user_id,
        ar.request_id,
        ar.report_type,
        ar.reason,
        ar.rating,
        ar.details,
        ar.status,
        ar.created_at,
        ar.resolved_at,
        ar.reviewed_by,
        ar.review_started_at,
        ar.resolution_note,
        ar.updated_at`;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value as string);
}

function rowToReport(row: Record<string, unknown>): FeedbackReport {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    requestId: String(row.request_id),
    reportType: row.report_type as FeedbackReportType,
    reason: String(row.reason),
    // SMALLINT comes back as a number, but a mutation's RETURNING * goes through
    // the same mapper, so normalise defensively.
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    details: (row.details as string | null) ?? null,
    status: row.status as FeedbackReportStatus,
    createdAt: toDate(row.created_at) ?? new Date(0),
    resolvedAt: toDate(row.resolved_at),
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewStartedAt: toDate(row.review_started_at),
    resolutionNote: (row.resolution_note as string | null) ?? null,
    updatedAt: toDate(row.updated_at),
    reporterEmail: (row.reporter_email as string | null) ?? null,
    reporterName: (row.reporter_name as string | null) ?? null,
    reporterDeleted: row.reporter_deleted === true,
    requestTitle: (row.request_title as string | null) ?? null,
  };
}

/**
 * Build the shared WHERE fragment for the list/count/summary reads.
 *
 * Returns positional placeholders starting at `$1`; the caller appends its own
 * (LIMIT/OFFSET) after `values.length`.
 */
function buildFilters(
  options: ListReportsOptions,
  { includeStatus = true }: { includeStatus?: boolean } = {}
): { clause: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.reportType) {
    values.push(options.reportType);
    conditions.push(`ar.report_type = $${values.length}`);
  }
  if (includeStatus && options.status && options.status !== "all") {
    values.push(options.status);
    conditions.push(`ar.status = $${values.length}`);
  }
  if (options.reason) {
    values.push(options.reason);
    conditions.push(`ar.reason = $${values.length}`);
  }
  if (typeof options.minRating === "number") {
    values.push(options.minRating);
    // Unrated rows (all safety reports) are excluded by the NULL comparison,
    // which is what a rating filter should mean.
    conditions.push(`ar.rating >= $${values.length}`);
  }
  if (options.from) {
    values.push(options.from);
    conditions.push(`ar.created_at >= $${values.length}`);
  }
  if (options.to) {
    // Exclusive upper bound — `parseDateRange` hands over the start of the day
    // AFTER the last included one.
    values.push(options.to);
    conditions.push(`ar.created_at < $${values.length}`);
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join("\n           AND ")}` : "",
    values,
  };
}

export class AdminFeedbackService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * One page of reports, newest first, with the reporter and the request title
   * resolved.
   *
   * THE JOIN THAT BITES: `ai_content_reports.request_id` is TEXT while
   * `clip_requests.id` is uuid in production and TEXT in `migrations/002`
   * (migration 006 documents the split, and 019 works around it with type-aware
   * DO blocks). An uncast `ar.request_id = cr.id` therefore compiles in one
   * environment and throws `operator does not exist: uuid = text` in the other.
   * `cr.id::text` is correct in both — casting text to text is a no-op.
   *
   * The reporter join is a LEFT JOIN even though `user_id` is a real FK with
   * ON DELETE CASCADE: account deletion ANONYMISES in place (`users.deleted_at`,
   * migration 014) rather than deleting the row, so the join does resolve — but
   * to `Deleted user` / `deleted:<uuid>`. Those placeholders are suppressed here
   * and the report is still returned, because the feedback is real whether or
   * not the account behind it still is.
   */
  async listReports(options: ListReportsOptions = {}): Promise<FeedbackReport[]> {
    const { clause, values } = buildFilters(options);
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);

    values.push(limit, offset);

    const { rows } = await this.db.query(
      `SELECT ${REPORT_COLUMNS},
              CASE WHEN u.deleted_at IS NULL THEN u.email END     AS reporter_email,
              CASE WHEN u.deleted_at IS NULL THEN u.full_name END AS reporter_name,
              (u.deleted_at IS NOT NULL)                          AS reporter_deleted,
              cr.title                                            AS request_title
         FROM ai_content_reports ar
         LEFT JOIN users u ON u.id = ar.user_id
         LEFT JOIN clip_requests cr ON cr.id::text = ar.request_id::text
         ${clause}
        ORDER BY ar.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return rows.map(rowToReport);
  }

  /** How many reports match the filters, ignoring limit/offset. */
  async countReports(options: ListReportsOptions = {}): Promise<number> {
    const { clause, values } = buildFilters(options);
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS count FROM ai_content_reports ar ${clause}`,
      values
    );
    // `::int` in SQL rather than parseInt here: pg hands back COUNT(*) (bigint)
    // as a STRING, and `"12" > 0` lies in ways that are hard to spot.
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Report counts per tab, for the tab labels.
   *
   * One query with FILTER rather than two round trips, because the two numbers
   * are rendered side by side and must agree on the same snapshot.
   */
  async getTypeCounts(
    options: Omit<ListReportsOptions, "reportType"> = {}
  ): Promise<Record<FeedbackReportType, number>> {
    const { clause, values } = buildFilters(options);
    const { rows } = await this.db.query(
      `SELECT (COUNT(*) FILTER (WHERE ar.report_type = 'feedback'))::int AS feedback,
              (COUNT(*) FILTER (WHERE ar.report_type = 'safety'))::int   AS safety
         FROM ai_content_reports ar
         ${clause}`,
      values
    );
    return {
      feedback: Number(rows[0]?.feedback ?? 0),
      safety: Number(rows[0]?.safety ?? 0),
    };
  }

  /**
   * Headline numbers for one tab: the triage backlog, what people complain
   * about, and whether the average rating is moving.
   *
   * The status counts deliberately ignore any status FILTER the page has
   * applied — a summary that only counted the rows already on screen would
   * always read "open: N, everything else: 0".
   */
  async getSummary(
    options: Omit<ListReportsOptions, "status" | "limit" | "offset"> = {}
  ): Promise<FeedbackSummary> {
    const { clause, values } = buildFilters(options, { includeStatus: false });

    // The trend only plots rated rows, so it carries one extra condition. The
    // filter clause may be empty (no range, no type), hence the WHERE/AND choice
    // rather than a blind `${clause} AND ...`.
    const ratedClause = clause
      ? `${clause}\n           AND ar.rating IS NOT NULL`
      : "WHERE ar.rating IS NOT NULL";

    const [statusResult, reasonResult, trendResult] = await Promise.all([
      this.db.query(
        `SELECT ar.status,
                COUNT(*)::int          AS count,
                AVG(ar.rating)::float8 AS avg_rating,
                COUNT(ar.rating)::int  AS rated_count
           FROM ai_content_reports ar
           ${clause}
          GROUP BY ar.status`,
        values
      ),
      this.db.query(
        `SELECT ar.reason, COUNT(*)::int AS count
           FROM ai_content_reports ar
           ${clause}
          GROUP BY ar.reason
          ORDER BY count DESC, ar.reason`,
        values
      ),
      this.db.query(
        // Bucketed in Bangkok, not UTC: the business day is Asia/Bangkok, and a
        // report left at 7am local would otherwise land on the previous day.
        `SELECT to_char((ar.created_at AT TIME ZONE '${REPORTING_TIMEZONE}')::date, 'YYYY-MM-DD') AS day,
                AVG(ar.rating)::float8 AS avg_rating,
                COUNT(*)::int          AS count
           FROM ai_content_reports ar
           ${ratedClause}
          GROUP BY 1
          ORDER BY 1`,
        values
      ),
    ]);

    const byStatus: Record<FeedbackReportStatus, number> = {
      open: 0,
      reviewing: 0,
      resolved: 0,
      dismissed: 0,
    };
    let total = 0;
    let ratedCount = 0;
    let ratingSum = 0;

    for (const row of statusResult.rows) {
      const count = Number(row.count ?? 0);
      byStatus[row.status as FeedbackReportStatus] = count;
      total += count;
      const rated = Number(row.rated_count ?? 0);
      ratedCount += rated;
      // AVG() is NUMERIC; `::float8` makes pg parse it to a number, but a driver
      // that still hands over a string would silently concatenate here.
      if (rated > 0 && row.avg_rating !== null && row.avg_rating !== undefined) {
        ratingSum += Number(row.avg_rating) * rated;
      }
    }

    return {
      byStatus,
      byReason: reasonResult.rows.map((row) => ({
        reason: String(row.reason),
        count: Number(row.count ?? 0),
      })),
      averageRating: ratedCount > 0 ? ratingSum / ratedCount : null,
      ratedCount,
      total,
      ratingTrend: trendResult.rows.map((row) => ({
        date: String(row.day),
        averageRating: Number(row.avg_rating ?? 0),
        count: Number(row.count ?? 0),
      })),
    };
  }

  /**
   * open → reviewing. Claims the report for an admin.
   *
   * `reviewed_by` is overwritten rather than coalesced: accepting a report for
   * review is the act of taking ownership of it, so the last admin to click is
   * the one on the hook.
   */
  async startReview(id: string, adminUserId: string): Promise<FeedbackReport> {
    return this.applyTransition(id, "review", {
      sql: `SET status = 'reviewing',
                review_started_at = NOW(),
                reviewed_by = $2,
                updated_at = NOW()`,
      values: [adminUserId],
    });
  }

  /** open | reviewing → resolved. Something was actually done about it. */
  async resolve(id: string, adminUserId: string, note?: string | null): Promise<FeedbackReport> {
    return this.applyTransition(id, "resolve", {
      sql: `SET status = 'resolved',
                resolved_at = NOW(),
                resolution_note = COALESCE($3, resolution_note),
                /* Resolving straight from 'open' skips the claim step, so this
                   may be the first admin the row has ever seen. An existing
                   owner from an earlier "accept for review" is kept. A block
                   comment rather than a line comment: this SQL is assembled from
                   fragments, and a line comment would swallow everything after
                   it if the statement were ever flattened onto one line. */
                reviewed_by = COALESCE(reviewed_by, $2),
                updated_at = NOW()`,
      values: [adminUserId, normaliseNote(note)],
    });
  }

  /** open | reviewing → dismissed. Spam, a duplicate, or not actionable. */
  async dismiss(id: string, adminUserId: string, note?: string | null): Promise<FeedbackReport> {
    return this.applyTransition(id, "dismiss", {
      // `resolved_at` doubles as "left the queue at", which is what the age and
      // backlog numbers need; the status column says HOW it left.
      sql: `SET status = 'dismissed',
                resolved_at = NOW(),
                resolution_note = COALESCE($3, resolution_note),
                reviewed_by = COALESCE(reviewed_by, $2),
                updated_at = NOW()`,
      values: [adminUserId, normaliseNote(note)],
    });
  }

  /**
   * Guarded UPDATE shared by the three triage actions.
   *
   * The status guard lives in the WHERE clause, so two admins clicking the same
   * button at the same moment cannot both "win" — the second one updates zero
   * rows. Only then (the failure path, never the happy one) does it read the row
   * back to say whether the id was wrong or the transition was.
   */
  private async applyTransition(
    id: string,
    action: keyof typeof TRIAGE_TRANSITIONS,
    update: { sql: string; values: unknown[] }
  ): Promise<FeedbackReport> {
    if (!UUID_PATTERN.test(id)) {
      throw new FeedbackReportNotFoundError(id);
    }

    const allowed = TRIAGE_TRANSITIONS[action];
    const { rows } = await this.db.query(
      `UPDATE ai_content_reports ar
          ${update.sql}
        WHERE ar.id = $1
          AND ar.status = ANY($${update.values.length + 2}::text[])
        RETURNING ${REPORT_COLUMNS.replace(/^\s+/, "")}`,
      [id, ...update.values, allowed]
    );

    if (rows[0]) return rowToReport(rows[0]);

    const { rows: existing } = await this.db.query(
      "SELECT status FROM ai_content_reports WHERE id = $1",
      [id]
    );
    if (!existing[0]) {
      throw new FeedbackReportNotFoundError(id);
    }
    throw new FeedbackTransitionError(
      `Cannot ${action} a report that is already ${existing[0].status}. ` +
        `Allowed from: ${allowed.join(", ")}.`
    );
  }
}

/** Blank textarea → NULL, so COALESCE keeps any note already on the row. */
function normaliseNote(note?: string | null): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

export const adminFeedbackService = new AdminFeedbackService();
