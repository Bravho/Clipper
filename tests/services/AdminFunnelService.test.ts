import {
  AdminFunnelService,
  FUNNEL_STAGES,
  findBiggestDrop,
  monotonicWarnings,
} from "@/services/admin/AdminFunnelService";
import type { FunnelStageCount } from "@/services/admin/AdminFunnelService";

/**
 * The nine-stage signup → publish funnel.
 *
 * What is worth pinning down here is not "does a number come back" but the
 * handful of things that would make this page quietly wrong in production:
 *
 *   - `pg` hands back every COUNT/SUM as a STRING. String concatenation instead
 *     of addition would turn 12 + 7 into "127" and nobody would question a
 *     funnel that looks busy;
 *   - the aggregate funnel is summed from the SAME rows as the cohort table, so
 *     the two can never disagree — that is the whole reason it is one query;
 *   - the monotonic guard, because a funnel that widens is a join bug and must
 *     surface as a warning rather than as a bar wider than its parent;
 *   - the backfill exclusion, without which every pre-instrumentation cohort
 *     reports a 100% login rate;
 *   - the explicit `::text` casts, because `clip_requests.user_id` is TEXT with
 *     no FK to `users.id` (uuid) — an uncast join works in exactly one of the
 *     two environments.
 *
 * The pool is constructor-injected (the `ManagementAuditService` /
 * `AdminFeedbackService` pattern), so a stub is enough — no live Postgres.
 */

type Responder = (sql: string, values: unknown[]) => Record<string, unknown>[];

function stubDb(responder?: Responder) {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, values?: unknown[]) => {
      // The services probe `to_regclass` before touching a table added by
      // migration 028, so a missing migration degrades to a banner instead of a
      // 500. That probe is plumbing, not behaviour under test: answer it
      // "present" and keep it out of `calls`, so every assertion about which
      // query ran first, and about SQL contents, stays about the real queries.
      if (text.includes("to_regclass")) {
        return { rows: [{ present: true }] };
      }
      calls.push({ text, values: values ?? [] });
      return { rows: responder?.(text, values ?? []) ?? [] };
    }),
  };
}

/** Collapse whitespace so assertions do not depend on SQL formatting. */
const flat = (sql: string) => sql.replace(/\s+/g, " ");

/**
 * One cohort row exactly as `pg` would hand it over: every count a STRING.
 * `users` and `events` are given in stage order (nine entries each).
 */
function cohortRow(
  week: string,
  users: number[],
  events: number[] = users,
  chargedUsers = users[4] ?? 0
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    cohort_week: week,
    charged_users: String(chargedUsers),
  };
  users.forEach((count, i) => {
    row[`s${i + 1}_users`] = String(count);
    row[`s${i + 1}_events`] = String(events[i]);
  });
  return row;
}

const FROM = new Date("2026-07-01T17:00:00Z");
const TO = new Date("2026-08-16T17:00:00Z");

/** Nine stage counts, as the service would have assembled them. */
function stagesFrom(users: number[]): FunnelStageCount[] {
  return FUNNEL_STAGES.map((stage, i) => ({
    ...stage,
    users: users[i],
    events: users[i],
  }));
}

describe("numeric-string parsing", () => {
  it("adds cohort counts as numbers, not as concatenated strings", async () => {
    const db = stubDb(() => [
      cohortRow("2026-07-06", [12, 9, 6, 4, 3, 2, 1, 1, 1]),
      cohortRow("2026-07-13", [7, 5, 4, 3, 2, 1, 0, 0, 0]),
    ]);
    const service = new AdminFunnelService(db);

    const report = await service.getFunnelReport(FROM, TO);

    // 12 + 7 = 19, never "127".
    expect(report.totalUsers).toBe(19);
    expect(report.stages[0].users).toBe(19);
    expect(report.stages[1].users).toBe(14);
    expect(report.stages[4].users).toBe(5);
    expect(typeof report.stages[0].users).toBe("number");
  });

  it("keeps the aggregate funnel and the cohort table in agreement", async () => {
    const db = stubDb(() => [
      cohortRow("2026-07-06", [12, 9, 6, 4, 3, 2, 1, 1, 1]),
      cohortRow("2026-07-13", [7, 5, 4, 3, 2, 1, 0, 0, 0]),
    ]);

    const report = await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    // Both views come from one query on purpose: summing the cohort column must
    // reproduce the headline stage exactly, or one of the two is lying.
    FUNNEL_STAGES.forEach((_, i) => {
      const summed = report.cohorts.reduce((total, row) => total + row.users[i], 0);
      expect(report.stages[i].users).toBe(summed);
    });
  });

  it("treats missing and unparseable cells as zero rather than NaN", async () => {
    const db = stubDb(() => [
      { cohort_week: "2026-07-06", s1_users: "5", s3_users: null, s4_users: "oops" },
    ]);

    const report = await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    expect(report.stages[2].users).toBe(0);
    expect(report.stages[3].users).toBe(0);
    expect(report.stages.every((stage) => Number.isFinite(stage.users))).toBe(true);
  });

  it("parses the trend series and the instrumentation counts", async () => {
    const db = stubDb((sql) =>
      sql.includes("generate_series")
        ? [
            { date: "2026-08-01", signups: "3", logins: "2" },
            { date: "2026-08-02", signups: "0", logins: "0" },
          ]
        : [
            {
              first_real_login: "2026-08-16T02:15:00.000Z",
              real_rows: "41",
              backfill_rows: "308",
            },
          ]
    );
    const service = new AdminFunnelService(db);

    const trend = await service.getSignupLoginTrend(FROM, TO);
    expect(trend).toEqual([
      { date: "2026-08-01", signups: 3, logins: 2 },
      { date: "2026-08-02", signups: 0, logins: 0 },
    ]);

    const instrumentation = await service.getLoginInstrumentation();
    expect(instrumentation.firstRealLoginAt).toEqual(
      new Date("2026-08-16T02:15:00.000Z")
    );
    expect(instrumentation.realLoginRows).toBe(41);
    expect(instrumentation.backfillRows).toBe(308);
  });

  it("reports no instrumentation date when only backfill rows exist", async () => {
    const db = stubDb(() => [
      { first_real_login: null, real_rows: "0", backfill_rows: "308" },
    ]);

    const instrumentation = await new AdminFunnelService(db).getLoginInstrumentation();

    // The page keys its "stages 1-2 are not retroactive" note off this: null
    // means stage 2 is structurally zero, not that retention collapsed.
    expect(instrumentation.firstRealLoginAt).toBeNull();
    expect(instrumentation.realLoginRows).toBe(0);
  });
});

describe("monotonic funnel guard", () => {
  it("stays silent on a funnel that only ever narrows", () => {
    expect(monotonicWarnings(stagesFrom([100, 80, 60, 40, 20, 10, 5, 3, 1]))).toEqual(
      []
    );
  });

  it("accepts a flat funnel — equal is not widening", () => {
    expect(monotonicWarnings(stagesFrom([10, 10, 10, 10, 10, 10, 10, 10, 10]))).toEqual(
      []
    );
  });

  it("names the offending pair and calls it a bug when a later stage exceeds an earlier one", () => {
    const warnings = monotonicWarnings(
      stagesFrom([100, 80, 60, 90, 20, 10, 5, 3, 1])
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("bug");
    expect(warnings[0].fromStage).toBe(3);
    expect(warnings[0].toStage).toBe(4);
    expect(warnings[0].message).toContain("Reached the final step");
    expect(warnings[0].message).toContain("Started generating a video");
    expect(warnings[0].message).toContain("90");
    expect(warnings[0].message).toContain("60");
  });

  it("demotes the login → generation pair, which widens whenever login data is short", () => {
    // Stage 2 only has data from the day instrumentation shipped, so this pair
    // widens for every earlier cohort. Left at "bug" severity the red banner
    // would be permanent, and a permanent alarm is furniture.
    const [warning] = monotonicWarnings(stagesFrom([100, 20, 60, 40, 20, 10, 5, 3, 1]));

    expect(warning.severity).toBe("known-gap");
    expect(warning.message).toContain("before login tracking existed");
  });

  it("demotes the transfer → upload pair, which are independent entry paths", () => {
    const [warning] = monotonicWarnings(stagesFrom([100, 80, 60, 40, 20, 3, 9, 3, 1]));

    expect(warning.severity).toBe("known-gap");
    expect(warning.message).toContain("independent entry paths");

    // Every other pair stays a bug.
    const [paid] = monotonicWarnings(stagesFrom([100, 80, 60, 40, 20, 10, 5, 40, 1]));
    expect(paid.severity).toBe("bug");
    expect(paid.message).not.toContain("independent entry paths");
  });

  it("surfaces the warning through the report rather than hiding the widening", async () => {
    const db = stubDb(() => [
      cohortRow("2026-07-06", [10, 8, 6, 11, 2, 1, 1, 1, 1]),
    ]);

    const report = await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    // The stage counts are still returned as measured — the page draws the
    // warning beside them, it does not get silently corrected data.
    expect(report.stages[3].users).toBe(11);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].severity).toBe("bug");
    expect(report.warnings[0].message).toContain("A funnel cannot widen");
  });
});

describe("headline figures", () => {
  it("computes conversion as stage 1 → stage 5", async () => {
    const db = stubDb(() => [cohortRow("2026-07-06", [200, 150, 90, 60, 50, 5, 2, 2, 1])]);

    const report = await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    expect(report.overallConversionPct).toBeCloseTo(25);
  });

  it("returns zero conversion instead of NaN when nobody signed up", async () => {
    const report = await new AdminFunnelService(stubDb(() => [])).getFunnelReport(
      FROM,
      TO
    );

    expect(report.totalUsers).toBe(0);
    expect(report.overallConversionPct).toBe(0);
    expect(report.biggestDrop).toBeNull();
    expect(report.cohorts).toEqual([]);
  });

  it("picks the largest absolute drop, not the largest percentage one", () => {
    // 100 → 40 loses 60 users; 4 → 1 loses 75% but only three people. The tile
    // is there to point at the stage worth fixing.
    const drop = findBiggestDrop(stagesFrom([100, 40, 30, 20, 10, 8, 6, 4, 1]));

    expect(drop).not.toBeNull();
    expect(drop!.dropped).toBe(60);
    expect(drop!.fromLabel).toBe("Signed up");
    expect(drop!.toLabel).toBe("Logged in");
    expect(drop!.pct).toBeCloseTo(60);
  });

  it("resolves ties to the earliest pair", () => {
    const drop = findBiggestDrop(stagesFrom([50, 40, 30, 30, 30, 30, 30, 30, 30]));

    expect(drop!.fromLabel).toBe("Signed up");
    expect(drop!.dropped).toBe(10);
  });
});

describe("the SQL itself", () => {
  it("excludes the synthetic backfill provider from every login count", async () => {
    const db = stubDb(() => []);
    const service = new AdminFunnelService(db);

    await service.getFunnelReport(FROM, TO);
    await service.getSignupLoginTrend(FROM, TO);

    // Backfill rows were derived from users.created_at, so counting them would
    // report a 100% login rate for every cohort that predates instrumentation.
    for (const call of db.calls) {
      expect(flat(call.text)).toContain("provider <> 'backfill'");
    }
  });

  it("casts BOTH sides of every id join, so the SQL holds in either id shape", async () => {
    const db = stubDb(() => []);
    await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    const sql = flat(db.calls[0].text);

    // This assertion was originally written the other way round — one side cast,
    // the other bare — and it passed while production 500'd with
    // `operator does not exist: text = uuid`. clip_requests.id,
    // video_generation_jobs.id and .request_id are each uuid in some
    // deployments and text in others, so casting only one side is correct in
    // exactly one environment and broken in the other.
    expect(sql).toContain("j.request_id::text = cr.id::text");
    expect(sql).toContain("j.id::text = h.job_id::text");
    expect(sql).toContain("cr.id::text = j.request_id::text");

    // Same rule for the cohort joins: clip_requests.user_id is TEXT with no FK,
    // while users.id and the Management tables' user_id are uuid. Casting every
    // one of them to text is the only form that works for all of them at once.
    for (const cte of ["s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "charged"]) {
      expect(sql).toContain(`${cte}.user_id::text = c.user_id::text`);
    }
  });

  it("honours users.deleted_at and bucket weeks in Bangkok", async () => {
    const db = stubDb(() => []);
    await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("u.deleted_at IS NULL");
    expect(sql).toContain("date_trunc('week', u.created_at AT TIME ZONE $3)");
    expect(db.calls[0].values).toEqual([FROM, TO, "Asia/Bangkok"]);
  });

  it("does not un-count a Management stage because the item was later removed", async () => {
    const db = stubDb(() => []);
    await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    // The transfer or upload happened; tidying the item away afterwards must
    // not rewrite the funnel. (users.deleted_at IS the one soft delete honoured.)
    expect(flat(db.calls[0].text)).not.toContain("removed_at");
  });

  it("cross-checks stage 5 against the credit ledger, from a different table", async () => {
    const db = stubDb(() => [
      cohortRow("2026-07-06", [40, 30, 20, 15, 10, 4, 2, 2, 1], undefined, 12),
    ]);

    const report = await new AdminFunnelService(db).getFunnelReport(FROM, TO);

    expect(flat(db.calls[0].text)).toContain("ct.type = 'request_charge'");
    // Ten users unlocked a download; twelve were charged. The gap is the point.
    expect(report.stages[4].users).toBe(10);
    expect(report.chargedUsers).toBe(12);
  });
});
