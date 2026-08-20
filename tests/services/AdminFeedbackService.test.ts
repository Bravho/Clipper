import {
  AdminFeedbackService,
  FEEDBACK_REASONS,
  FeedbackReportNotFoundError,
  FeedbackTransitionError,
  SAFETY_REASONS,
  TRIAGE_TRANSITIONS,
  isReasonForType,
  reasonsForType,
} from "@/services/admin/AdminFeedbackService";

/**
 * Feedback and AI-content report triage (`ai_content_reports`).
 *
 * The table was write-only before this service: one INSERT, no reader, and
 * `status` / `resolved_at` never written by any code. So the contract worth
 * pinning down is not "does a row come back" but the things a mistake would
 * make quietly wrong in production:
 *
 *   - the transition rules, including the deliberate asymmetry that `resolve`
 *     and `dismiss` accept `open` (an admin who fixes something on sight should
 *     not have to claim it first) while `review` does not;
 *   - the guard living in the WHERE clause, so a losing race updates zero rows
 *     rather than overwriting a decision another admin just made;
 *   - the `cr.id::text` cast, because `clip_requests.id` is uuid in production
 *     and TEXT in the DDL — an uncast join works in exactly one of the two;
 *   - `COUNT(*)`/NUMERIC arriving from `pg` as STRINGS.
 *
 * The pool is constructor-injected (the `GateEventService` pattern), so a stub
 * is enough — no live Postgres.
 */

type Responder = (sql: string, values: unknown[]) => Record<string, unknown>[];

function stubDb(responder?: Responder) {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      return { rows: responder?.(text, values ?? []) ?? [] };
    }),
  };
}

/** Collapse whitespace so assertions do not depend on SQL formatting. */
const flat = (sql: string) => sql.replace(/\s+/g, " ");

/** A row shaped like `RETURNING *` from a triage UPDATE. */
function updatedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    user_id: "8b1d1a0e-0000-4000-8000-000000000002",
    request_id: "req-1",
    report_type: "feedback",
    reason: "video_quality",
    rating: 2,
    details: "The subtitles were out of sync.",
    status: "reviewing",
    created_at: new Date("2026-08-01T03:00:00Z"),
    resolved_at: null,
    reviewed_by: ADMIN_ID,
    review_started_at: new Date("2026-08-02T03:00:00Z"),
    resolution_note: null,
    updated_at: new Date("2026-08-02T03:00:00Z"),
    ...overrides,
  };
}

const REPORT_ID = "3f7c6b2a-1111-4111-8111-111111111111";
const ADMIN_ID = "9a2b3c4d-2222-4222-8222-222222222222";

describe("reason / report_type pairing", () => {
  it("splits the sixteen CHECK values into two disjoint sets that cover them all", () => {
    // The DDL's CHECK accepts all sixteen for EITHER type — the pairing is only
    // enforced in application code, so drift between this list and the
    // constraint would be invisible until a row failed to insert.
    const all = [...SAFETY_REASONS, ...FEEDBACK_REASONS];
    expect(new Set(all).size).toBe(16);
    expect(all.sort()).toEqual(
      [
        "unsafe",
        "sexual",
        "violent",
        "hate",
        "privacy",
        "impersonation",
        "copyright",
        "misleading",
        "other",
        "video_quality",
        "scene_selection",
        "motion_direction",
        "audio_music",
        "subtitles",
        "aspect_ratio",
        "other_feedback",
      ].sort()
    );
  });

  it("offers each type only its own reasons", () => {
    expect(reasonsForType("feedback")).toEqual(FEEDBACK_REASONS);
    expect(reasonsForType("safety")).toEqual(SAFETY_REASONS);

    expect(isReasonForType("feedback", "video_quality")).toBe(true);
    expect(isReasonForType("feedback", "unsafe")).toBe(false);
    expect(isReasonForType("safety", "hate")).toBe(true);
    expect(isReasonForType("safety", "subtitles")).toBe(false);
  });

  it("keeps 'other' and 'other_feedback' on opposite sides", () => {
    // Easy to conflate; they are separate enum values and a report filed under
    // the wrong one lands on the wrong tab.
    expect(isReasonForType("safety", "other")).toBe(true);
    expect(isReasonForType("feedback", "other")).toBe(false);
    expect(isReasonForType("feedback", "other_feedback")).toBe(true);
    expect(isReasonForType("safety", "other_feedback")).toBe(false);
  });
});

describe("status transitions", () => {
  it("declares review as open-only, and both closing actions as open-or-reviewing", () => {
    expect(TRIAGE_TRANSITIONS.review).toEqual(["open"]);
    expect(TRIAGE_TRANSITIONS.resolve).toEqual(["open", "reviewing"]);
    expect(TRIAGE_TRANSITIONS.dismiss).toEqual(["open", "reviewing"]);
  });

  it("claims an open report for the admin who accepted it", async () => {
    const db = stubDb(() => [updatedRow()]);
    const service = new AdminFeedbackService(db);

    const report = await service.startReview(REPORT_ID, ADMIN_ID);

    expect(report.status).toBe("reviewing");
    expect(report.reviewedBy).toBe(ADMIN_ID);

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("SET status = 'reviewing'");
    expect(sql).toContain("review_started_at = NOW()");
    expect(sql).toContain("reviewed_by = $2");
    expect(sql).toContain("updated_at = NOW()");
    // The guard is in the WHERE clause, not a read-then-write.
    expect(sql).toContain("AND ar.status = ANY($3::text[])");
    expect(db.calls[0].values).toEqual([REPORT_ID, ADMIN_ID, ["open"]]);
    // The happy path must not need a second round trip.
    expect(db.calls).toHaveLength(1);
  });

  it("refuses to accept a report that is already in review, naming its state", async () => {
    // Guarded UPDATE matches nothing; the follow-up read explains why.
    const db = stubDb((sql) => (sql.includes("UPDATE") ? [] : [{ status: "reviewing" }]));
    const service = new AdminFeedbackService(db);

    await expect(service.startReview(REPORT_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      FeedbackTransitionError
    );
    await expect(service.startReview(REPORT_ID, ADMIN_ID)).rejects.toThrow(
      /already reviewing\. Allowed from: open/
    );
  });

  it("resolves straight from open without an intermediate review click", async () => {
    const db = stubDb(() => [updatedRow({ status: "resolved", resolved_at: new Date() })]);
    const service = new AdminFeedbackService(db);

    const report = await service.resolve(REPORT_ID, ADMIN_ID, "Re-rendered with fixed subtitles.");

    expect(report.status).toBe("resolved");
    const sql = flat(db.calls[0].text);
    expect(sql).toContain("SET status = 'resolved'");
    expect(sql).toContain("resolved_at = NOW()");
    // An owner set by an earlier "accept for review" must not be overwritten by
    // whoever happens to close the report.
    expect(sql).toContain("reviewed_by = COALESCE(reviewed_by, $2)");
    expect(db.calls[0].values).toEqual([
      REPORT_ID,
      ADMIN_ID,
      "Re-rendered with fixed subtitles.",
      ["open", "reviewing"],
    ]);
  });

  it("stores a blank or whitespace-only note as NULL so COALESCE keeps the old one", async () => {
    const db = stubDb(() => [updatedRow({ status: "resolved" })]);
    const service = new AdminFeedbackService(db);

    await service.resolve(REPORT_ID, ADMIN_ID, "   ");
    expect(db.calls[0].values[2]).toBeNull();

    await service.resolve(REPORT_ID, ADMIN_ID);
    expect(db.calls[1].values[2]).toBeNull();

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("resolution_note = COALESCE($3, resolution_note)");
  });

  it("dismisses from open or reviewing and stamps resolved_at like a resolve", async () => {
    const db = stubDb(() => [updatedRow({ status: "dismissed", resolved_at: new Date() })]);
    const service = new AdminFeedbackService(db);

    const report = await service.dismiss(REPORT_ID, ADMIN_ID, "Duplicate of the report above.");

    expect(report.status).toBe("dismissed");
    const sql = flat(db.calls[0].text);
    expect(sql).toContain("SET status = 'dismissed'");
    // `resolved_at` means "left the queue at" for both closing actions; the
    // status column is what says which one happened.
    expect(sql).toContain("resolved_at = NOW()");
    expect(db.calls[0].values[3]).toEqual(["open", "reviewing"]);
  });

  it("rejects closing an already-resolved report", async () => {
    const db = stubDb((sql) => (sql.includes("UPDATE") ? [] : [{ status: "resolved" }]));
    const service = new AdminFeedbackService(db);

    await expect(service.dismiss(REPORT_ID, ADMIN_ID)).rejects.toThrow(
      /Cannot dismiss a report that is already resolved/
    );
  });

  it("distinguishes a missing report from a bad transition", async () => {
    const db = stubDb(() => []); // update matched nothing AND the row does not exist
    const service = new AdminFeedbackService(db);

    await expect(service.resolve(REPORT_ID, ADMIN_ID)).rejects.toBeInstanceOf(
      FeedbackReportNotFoundError
    );
    await expect(service.resolve(REPORT_ID, ADMIN_ID)).rejects.toThrow(/not found/);
  });

  it("treats a non-uuid id as not found instead of letting Postgres raise a 500", async () => {
    const db = stubDb();
    const service = new AdminFeedbackService(db);

    await expect(service.startReview("not-a-uuid", ADMIN_ID)).rejects.toBeInstanceOf(
      FeedbackReportNotFoundError
    );
    // Never reached the database — `invalid input syntax for type uuid` would
    // surface as an opaque "Internal error".
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("listReports", () => {
  it("casts the request join, because clip_requests.id is uuid in production and TEXT in the DDL", async () => {
    const db = stubDb(() => []);
    await new AdminFeedbackService(db).listReports();

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("LEFT JOIN clip_requests cr ON cr.id::text = ar.request_id");
    // The uncast form is the bug this guards: it works in one environment and
    // throws `operator does not exist: uuid = text` in the other.
    expect(sql).not.toContain("cr.id = ar.request_id");
  });

  it("builds only the filters it was given, in placeholder order", async () => {
    const db = stubDb(() => []);
    const from = new Date("2026-07-01T00:00:00Z");
    const to = new Date("2026-08-01T00:00:00Z");

    await new AdminFeedbackService(db).listReports({
      reportType: "safety",
      status: "open",
      reason: "hate",
      minRating: 3,
      from,
      to,
      limit: 25,
      offset: 50,
    });

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("WHERE ar.report_type = $1");
    expect(sql).toContain("AND ar.status = $2");
    expect(sql).toContain("AND ar.reason = $3");
    expect(sql).toContain("AND ar.rating >= $4");
    expect(sql).toContain("AND ar.created_at >= $5");
    // Exclusive upper bound — parseDateRange hands over the start of the day
    // AFTER the last included one.
    expect(sql).toContain("AND ar.created_at < $6");
    expect(sql).toContain("LIMIT $7 OFFSET $8");
    expect(db.calls[0].values).toEqual(["safety", "open", "hate", 3, from, to, 25, 50]);
  });

  it("treats status 'all' as no status filter", async () => {
    const db = stubDb(() => []);
    await new AdminFeedbackService(db).listReports({ status: "all", reportType: "feedback" });

    expect(flat(db.calls[0].text)).not.toContain("ar.status =");
    expect(db.calls[0].values.slice(0, 1)).toEqual(["feedback"]);
  });

  it("clamps the page size so a hand-edited URL cannot ask for the whole table", async () => {
    const db = stubDb(() => []);
    const service = new AdminFeedbackService(db);

    await service.listReports({ limit: 100_000, offset: -5 });
    expect(db.calls[0].values).toEqual([500, 0]);
  });

  it("shows a deleted reporter's report but not their anonymised identity", async () => {
    // Account deletion anonymises in place (migration 014): full_name becomes
    // 'Deleted user' and email becomes 'deleted:<uuid>'. Rendering those would
    // be worse than saying nothing, but the report itself is still real.
    const db = stubDb(() => [
      {
        ...updatedRow({ status: "open" }),
        reporter_email: null,
        reporter_name: null,
        reporter_deleted: true,
        request_title: null,
      },
    ]);

    const [report] = await new AdminFeedbackService(db).listReports();

    expect(report.reporterDeleted).toBe(true);
    expect(report.reporterEmail).toBeNull();
    expect(report.requestTitle).toBeNull();

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("CASE WHEN u.deleted_at IS NULL THEN u.email END");
    expect(sql).toContain("LEFT JOIN users u ON u.id = ar.user_id");
  });
});

describe("countReports", () => {
  it("reads COUNT(*) as a number — pg hands bigint back as a string", async () => {
    // `"12" > 0` is true and `"12" + 1` is "121"; the ::int cast plus Number()
    // is what keeps the tab badges honest.
    const db = stubDb(() => [{ count: "12" }]);
    const total = await new AdminFeedbackService(db).countReports({ reportType: "safety" });

    expect(total).toBe(12);
    expect(typeof total).toBe("number");
    expect(flat(db.calls[0].text)).toContain("COUNT(*)::int AS count");
  });

  it("returns zero rather than NaN when the table has no matching rows", async () => {
    const db = stubDb(() => []);
    await expect(new AdminFeedbackService(db).countReports()).resolves.toBe(0);
  });
});

describe("getSummary", () => {
  it("zero-fills every status and weights the average by each group's rated count", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("GROUP BY ar.status")) {
        return [
          { status: "open", count: 2, avg_rating: 2, rated_count: 2 },
          { status: "resolved", count: 4, avg_rating: 4, rated_count: 2 },
        ];
      }
      if (sql.includes("GROUP BY ar.reason")) {
        return [{ reason: "video_quality", count: 5 }];
      }
      return [{ day: "2026-08-01", avg_rating: 3, count: 4 }];
    });

    const summary = await new AdminFeedbackService(db).getSummary({ reportType: "feedback" });

    expect(summary.byStatus).toEqual({ open: 2, reviewing: 0, resolved: 4, dismissed: 0 });
    expect(summary.total).toBe(6);
    expect(summary.ratedCount).toBe(4);
    // (2×2 + 4×2) / 4 — averaging the two group averages directly would also
    // give 3 here, so the groups are deliberately unequal below.
    expect(summary.averageRating).toBe(3);
    expect(summary.byReason).toEqual([{ reason: "video_quality", count: 5 }]);
    expect(summary.ratingTrend).toEqual([
      { date: "2026-08-01", averageRating: 3, count: 4 },
    ]);
  });

  it("does not average the group averages", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("GROUP BY ar.status")) {
        return [
          { status: "open", count: 9, avg_rating: "1", rated_count: 9 },
          { status: "resolved", count: 1, avg_rating: "5", rated_count: 1 },
        ];
      }
      return [];
    });

    const summary = await new AdminFeedbackService(db).getSummary({});

    // Nine 1-star reports and one 5-star report average 1.4, not 3.
    expect(summary.averageRating).toBeCloseTo(1.4, 5);
  });

  it("reports a null average when nothing in range carried a rating", async () => {
    // The normal case on the safety tab: `rating` is only ever set for feedback.
    const db = stubDb((sql) =>
      sql.includes("GROUP BY ar.status")
        ? [{ status: "open", count: 3, avg_rating: null, rated_count: 0 }]
        : []
    );

    const summary = await new AdminFeedbackService(db).getSummary({ reportType: "safety" });
    expect(summary.averageRating).toBeNull();
    expect(summary.total).toBe(3);
  });

  it("ignores the caller's status filter and buckets the trend in Bangkok", async () => {
    const db = stubDb(() => []);
    await new AdminFeedbackService(db).getSummary({
      reportType: "feedback",
      from: new Date("2026-07-01T00:00:00Z"),
    });

    for (const call of db.calls) {
      // A summary that only counted the rows already on screen would always
      // read "open: N, everything else: 0".
      expect(flat(call.text)).not.toContain("ar.status = $");
    }

    const trend = db.calls.find((call) => call.text.includes("GROUP BY 1"))!;
    const sql = flat(trend.text);
    // A 7am Bangkok rating belongs to that Bangkok day, not the previous UTC one.
    expect(sql).toContain("AT TIME ZONE 'Asia/Bangkok'");
    expect(sql).toContain("AND ar.rating IS NOT NULL");
  });

  it("still produces a valid trend query when there are no filters at all", async () => {
    const db = stubDb(() => []);
    await new AdminFeedbackService(db).getSummary();

    const trend = db.calls.find((call) => call.text.includes("GROUP BY 1"))!;
    const sql = flat(trend.text);
    // The rated condition has to introduce the WHERE itself when nothing else did.
    expect(sql).toContain("WHERE ar.rating IS NOT NULL");
    expect(sql).not.toContain("AND ar.rating IS NOT NULL");
  });
});

describe("getTypeCounts", () => {
  it("counts both tabs in one query so the badges agree on one snapshot", async () => {
    const db = stubDb(() => [{ feedback: "7", safety: 2 }]);
    const counts = await new AdminFeedbackService(db).getTypeCounts({ status: "open" });

    expect(counts).toEqual({ feedback: 7, safety: 2 });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(flat(db.calls[0].text)).toContain(
      "(COUNT(*) FILTER (WHERE ar.report_type = 'feedback'))::int AS feedback"
    );
    // The tab badges DO follow the status filter: "how many open safety
    // reports" is the question an admin in the open queue is asking.
    expect(db.calls[0].values).toEqual(["open"]);
  });
});
