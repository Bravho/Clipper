import {
  ABANDONMENT_THRESHOLD_HOURS,
  AdminApprovalMetricsService,
  countHourSlots,
  findPeak,
  formatDuration,
  gateStepLabel,
} from "@/services/admin/AdminApprovalMetricsService";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

/**
 * Approval-click analytics (`pipeline_gate_events`, migration 028).
 *
 * The things a mistake would make quietly wrong in production, which is what is
 * pinned down here rather than "does a row come back":
 *
 *   - the pre-instrumentation fallback. The table starts EMPTY, so the estimated
 *     path is the one that will actually run first, and it must be chosen from
 *     the data (an in-range count) rather than from a hard-coded cutover date;
 *   - `actor_source = 'human'` on the heatmap. Express-lane auto-approvals fire
 *     whenever the worker finishes and would flatten exactly the peak the
 *     capacity model consumes;
 *   - `AT TIME ZONE 'Asia/Bangkok'` on every hour/day bucket. The columns are
 *     TIMESTAMPTZ, so an unconverted EXTRACT shifts the whole time-of-day
 *     analysis by seven hours;
 *   - the `j.id::text` join cast, because `video_generation_jobs.id` is TEXT in
 *     the DDL and uuid in some environments while `job_id` is TEXT everywhere;
 *   - a count is not a rate: the peak cell has to be divided by how many times
 *     that weekday-hour occurred in the range;
 *   - `COUNT(*)` and NUMERIC arriving from `pg` as STRINGS.
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

const RANGE = {
  from: new Date("2026-07-01T00:00:00Z"),
  to: new Date("2026-07-08T00:00:00Z"),
};

/** All the SQL the service issued, flattened. */
const sqlOf = (db: ReturnType<typeof stubDb>) => db.calls.map((call) => flat(call.text));

describe("formatDuration", () => {
  it("scales the unit to the magnitude and never prints raw milliseconds", () => {
    expect(formatDuration(1.4)).toBe("1.4s");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(150)).toBe("2m 30s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(4320)).toBe("1h 12m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(90_000)).toBe("1d 1h");
  });

  it("returns a dash rather than NaN for missing data", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("gateStepLabel", () => {
  it("gives every awaiting_* step an English label, falling back to the raw value", () => {
    const gates = Object.values(VideoGenerationStep).filter((step) =>
      step.startsWith("awaiting_")
    );
    for (const gate of gates) {
      expect(gateStepLabel(gate)).not.toBe("");
    }
    expect(gateStepLabel(VideoGenerationStep.AwaitingVideoApproval)).toBe(
      "Scene clip (per scene)"
    );
    // An unknown value must still render as something an admin can grep for.
    expect(gateStepLabel("awaiting_something_new")).toBe("awaiting_something_new");
  });
});

describe("countHourSlots", () => {
  it("counts each weekday-hour exactly, in Bangkok", () => {
    // Exactly one Bangkok week: every slot occurs once.
    const week = countHourSlots(
      new Date("2026-07-01T00:00:00+07:00"),
      new Date("2026-07-08T00:00:00+07:00")
    );
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        expect(week[day][hour]).toBe(1);
      }
    }
  });

  it("is Bangkok-local, not UTC — the offset would shift every slot by seven hours", () => {
    // 2026-07-01 07:00 Bangkok is 2026-07-01 00:00 UTC. One hour from there is
    // Wednesday 07:00 in Bangkok, and Wednesday is DOW 3.
    const oneHour = countHourSlots(
      new Date("2026-07-01T00:00:00Z"),
      new Date("2026-07-01T01:00:00Z")
    );
    expect(oneHour[3][7]).toBe(1);
    expect(oneHour[3][0]).toBe(0);
  });

  it("handles ranges that are not whole weeks", () => {
    // Ten days: three occurrences of some weekdays, two of the rest.
    const slots = countHourSlots(
      new Date("2026-07-01T00:00:00+07:00"),
      new Date("2026-07-11T00:00:00+07:00")
    );
    const total = slots.flat().reduce((sum, n) => sum + n, 0);
    expect(total).toBe(240);
  });
});

describe("findPeak", () => {
  it("turns the busiest cell into a RATE, dividing by that slot's occurrences", () => {
    // Four weeks: Monday 20:00 happens four times, so 40 clicks is 10/hour, not 40.
    const range = {
      from: new Date("2026-07-06T00:00:00+07:00"),
      to: new Date("2026-08-03T00:00:00+07:00"),
    };
    const peak = findPeak(
      [
        { dayOfWeek: 1, hour: 20, count: 40 },
        { dayOfWeek: 2, hour: 9, count: 12 },
      ],
      range
    );

    expect(peak).not.toBeNull();
    expect(peak!.dayOfWeek).toBe(1);
    expect(peak!.hour).toBe(20);
    expect(peak!.count).toBe(40);
    expect(peak!.occurrences).toBe(4);
    expect(peak!.ratePerHour).toBe(10);
  });

  it("is null when nothing was clicked", () => {
    expect(findPeak([], RANGE)).toBeNull();
    expect(findPeak([{ dayOfWeek: 1, hour: 20, count: 0 }], RANGE)).toBeNull();
  });
});

describe("AdminApprovalMetricsService — mode detection", () => {
  it("detects instrumentation from an in-range count, not from a hard-coded date", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("MIN(opened_at)")) {
        return [{ first_opened_at: "2026-06-01T00:00:00.000Z", in_range: "17" }];
      }
      return [];
    });
    const service = new AdminApprovalMetricsService(db);

    const probe = await service.probeInstrumentation(RANGE);

    expect(probe.gateEventsInRange).toBe(17); // "17" from pg, not "17" the string
    expect(probe.firstInstrumentedAt).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    expect(db.calls[0].values).toEqual([RANGE.from, RANGE.to]);
    // No literal date anywhere in the probe — the cutover is whatever the data says.
    expect(flat(db.calls[0].text)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("reads gate events when the range has them", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("MIN(opened_at)")) return [{ first_opened_at: null, in_range: "5" }];
      if (sql.includes("GROUP BY step")) {
        return [{ step: "awaiting_final_approval", human: "3", auto: "2", system: "0", unattributed: "0", total: "5" }];
      }
      return [];
    });
    const service = new AdminApprovalMetricsService(db);

    const metrics = await service.getMetrics(RANGE);

    expect(metrics.mode).toBe("instrumented");
    expect(sqlOf(db).some((sql) => sql.includes("video_generation_step_history"))).toBe(false);
    expect(metrics.actorSplit[0]).toEqual({
      step: "awaiting_final_approval",
      human: 3,
      auto: 2,
      system: 0,
      unattributed: 0,
      total: 5,
    });
    expect(metrics.gateEventsInRange).toBe(5);
  });

  it("buckets the heatmap in Bangkok and counts HUMAN resolutions only", async () => {
    const db = stubDb((sql) =>
      sql.includes("MIN(opened_at)") ? [{ first_opened_at: null, in_range: "5" }] : []
    );
    const service = new AdminApprovalMetricsService(db);

    await service.getMetrics(RANGE);

    const heatmapSql = sqlOf(db).find((sql) => sql.includes("AS day_of_week"));
    expect(heatmapSql).toBeDefined();
    expect(heatmapSql).toContain("EXTRACT(DOW FROM resolved_at AT TIME ZONE 'Asia/Bangkok')");
    expect(heatmapSql).toContain("EXTRACT(HOUR FROM resolved_at AT TIME ZONE 'Asia/Bangkok')");
    expect(heatmapSql).toContain("actor_source = 'human'");
  });

  it("casts the job id on every join — uuid = text throws in exactly one environment", async () => {
    const db = stubDb((sql) =>
      sql.includes("MIN(opened_at)") ? [{ first_opened_at: null, in_range: "5" }] : []
    );
    const service = new AdminApprovalMetricsService(db);

    await service.getMetrics(RANGE);

    const joinSql = sqlOf(db).filter((sql) => sql.includes("video_generation_jobs j"));
    expect(joinSql.length).toBeGreaterThan(0);
    for (const sql of joinSql) {
      expect(sql).toContain("j.id::text = p.job_id");
    }
  });

  it("passes the abandonment threshold as a parameter rather than inlining it", async () => {
    const db = stubDb((sql) =>
      sql.includes("MIN(opened_at)") ? [{ first_opened_at: null, in_range: "5" }] : []
    );
    const service = new AdminApprovalMetricsService(db);

    await service.getMetrics(RANGE);

    const openTotals = db.calls.find((call) => flat(call.text).includes("resolved_at IS NULL")
      && flat(call.text).includes("AS open_now"));
    expect(openTotals).toBeDefined();
    expect(openTotals!.values).toContain(String(ABANDONMENT_THRESHOLD_HOURS));
  });
});

describe("AdminApprovalMetricsService — pre-instrumentation fallback", () => {
  /** Instrumentation probe finds nothing in range: the estimated path runs. */
  const emptyProbe = (sql: string) =>
    sql.includes("MIN(opened_at)") ? [{ first_opened_at: null, in_range: "0" }] : [];

  it("falls back to step history when the gate table has no rows in the range", async () => {
    const db = stubDb(emptyProbe);
    const service = new AdminApprovalMetricsService(db);

    const metrics = await service.getMetrics(RANGE);

    expect(metrics.mode).toBe("estimated");
    const sql = sqlOf(db);
    expect(sql.some((s) => s.includes("video_generation_step_history"))).toBe(true);
    // Nothing but the probe may touch the empty table — otherwise the page would
    // silently mix an empty measured series into an estimated one.
    expect(sql.filter((s) => s.includes("pipeline_gate_events"))).toHaveLength(1);
  });

  it("derives a click from the row that FOLLOWS an awaiting_* step, via LAG", async () => {
    const db = stubDb(emptyProbe);
    const service = new AdminApprovalMetricsService(db);

    await service.getMetrics(RANGE);

    const clickSql = sqlOf(db).find((s) => s.includes("LAG(step)"));
    expect(clickSql).toBeDefined();
    // The click's timestamp is the CAUSED row's created_at, and the wait is the
    // gap back to the gate row.
    expect(clickSql).toContain("LAG(created_at) OVER (PARTITION BY job_id ORDER BY created_at, id)");
    expect(clickSql).toContain("LEFT(prev_step, 9) = 'awaiting_'");
    expect(clickSql).toContain("created_at - prev_at");
    // The window must run over the WHOLE history; the range filter is applied
    // afterwards, or the first row inside the window looks like a click.
    expect(clickSql!.indexOf("FROM video_generation_step_history")).toBeLessThan(
      clickSql!.indexOf("created_at >= $1")
    );
  });

  it("still buckets estimated clicks in Bangkok", async () => {
    const db = stubDb(emptyProbe);
    const service = new AdminApprovalMetricsService(db);

    await service.getMetrics(RANGE);

    const heatmapSql = sqlOf(db).find((s) => s.includes("AS day_of_week"));
    expect(heatmapSql).toContain("EXTRACT(DOW FROM clicked_at AT TIME ZONE 'Asia/Bangkok')");
  });

  it("reports the actor as unattributed and notification as unknowable", async () => {
    const db = stubDb((sql, values) => {
      if (sql.includes("MIN(opened_at)")) return emptyProbe(sql);
      if (sql.includes("gate_step AS step, COUNT(*)::int AS total")) {
        return [{ step: "awaiting_video_approval", total: "9" }];
      }
      void values;
      return [];
    });
    const service = new AdminApprovalMetricsService(db);

    const metrics = await service.getMetrics(RANGE);

    // The express lane writes identical step-history rows, so claiming a split
    // here would be inventing precision.
    expect(metrics.actorSplit).toEqual([
      {
        step: "awaiting_video_approval",
        human: 0,
        auto: 0,
        system: 0,
        unattributed: 9,
        total: 9,
      },
    ]);
    // Null, not [] — "cannot know" and "measured zero" are different answers.
    expect(metrics.notification).toBeNull();
  });

  it("approximates open gates from the jobs themselves, with no abandoned count", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("MIN(opened_at)")) return emptyProbe(sql);
      if (sql.includes("FROM video_generation_jobs") && sql.includes("current_step AS step")) {
        return [{ step: "awaiting_final_approval", open_now: "4", stalled: "2" }];
      }
      return [];
    });
    const service = new AdminApprovalMetricsService(db);

    const metrics = await service.getMetrics(RANGE);

    expect(metrics.abandonment).toEqual([
      { step: "awaiting_final_approval", openNow: 4, stalled: 2, abandoned: 0 },
    ]);
    expect(metrics.openNowTotal).toBe(4);
    expect(metrics.stalledNowTotal).toBe(2);

    const jobsSql = sqlOf(db).find((s) => s.includes("current_step AS step"));
    expect(jobsSql).toContain("LEFT(current_step, 9) = 'awaiting_'");
  });

  it("parses pg's string aggregates into numbers throughout the estimated path", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("MIN(opened_at)")) return emptyProbe(sql);
      if (sql.includes("AS day_of_week")) {
        return [{ day_of_week: "1", hour: "20", count: "40" }];
      }
      if (sql.includes("auto_approve_remaining")) {
        return [
          {
            express: false,
            jobs: "6",
            total_clicks: "48",
            mean_clicks: "8",
            median_clicks: "8",
          },
        ];
      }
      if (sql.includes("AS median_seconds")) {
        return [
          {
            step: "awaiting_content_approval",
            samples: "6",
            mean_seconds: "900.5",
            median_seconds: "600",
            p90_seconds: "3600",
          },
        ];
      }
      return [];
    });
    const service = new AdminApprovalMetricsService(db);

    const metrics = await service.getMetrics(RANGE);

    expect(metrics.heatmap).toEqual([{ dayOfWeek: 1, hour: 20, count: 40 }]);
    expect(metrics.clicksPerJob).toEqual([
      { lane: "manual", jobs: 6, totalClicks: 48, meanClicks: 8, medianClicks: 8 },
    ]);
    expect(metrics.dwell[0].meanSeconds).toBeCloseTo(900.5, 5);
    expect(metrics.dwell[0].samples).toBe(6);
    // A rate, not a count: one week in the range means Monday 20:00 happened once.
    expect(metrics.peak!.ratePerHour).toBe(40);
  });
});
