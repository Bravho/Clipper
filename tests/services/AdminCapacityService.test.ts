import {
  AdminCapacityService,
  DEFAULT_TARGET_MINUTES,
  SAFE_UTILISATION,
  buildScenarios,
  erlangB,
  erlangC,
  erlangCMeanWait,
  erlangCWaitPercentile,
  parseTargetMinutes,
} from "@/services/admin/AdminCapacityService";

/**
 * Render-capacity model (`render_tasks`, `render_worker_samples`).
 *
 * The queueing maths is the part of this codebase where a plausible-looking
 * wrong answer does real damage: this page is used to argue for hardware, and
 * nobody reading it can tell a subtly broken Erlang-C from a correct one. So the
 * implementation is checked against published reference values and against the
 * closed forms that hold at small `c`, not against itself:
 *
 *   Erlang B  B(2, 1)  = 0.2                    (standard recursion check)
 *   Erlang C  C(1, a)  = a                      (M/M/1: everything queues at rate ρ)
 *             C(2, 1)  = 1/3                    (M/M/2 closed form 2ρ²/(1+ρ))
 *             C(3, 2)  = 4/9                    (textbook value)
 *             C(10, 8) ≈ 0.4090                 (published Erlang C table)
 *   M/M/1     Wq       = ρ·S/(1−ρ)
 *
 * Plus the two behaviours that matter more than accuracy: an unstable queue
 * (a ≥ c) must report an infinite wait rather than a large finite one, and an
 * under-loaded queue must report a p90 of exactly zero rather than a small
 * positive number, because more than 90% of jobs genuinely never wait.
 *
 * The pool is constructor-injected, so the SQL-shaped tests use a stub.
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

const flat = (sql: string) => sql.replace(/\s+/g, " ");
const sqlOf = (db: ReturnType<typeof stubDb>) => db.calls.map((call) => flat(call.text));

/** Exactly one week, so hour counts are whole and easy to reason about. */
const RANGE = {
  from: new Date("2026-07-01T00:00:00Z"),
  to: new Date("2026-07-08T00:00:00Z"),
};

describe("erlangB", () => {
  it("matches the standard recursion at known points", () => {
    expect(erlangB(1, 1)).toBeCloseTo(0.5, 12);
    expect(erlangB(2, 1)).toBeCloseTo(0.2, 12);
    expect(erlangB(3, 2)).toBeCloseTo(0.21052631578947367, 12);
    // 10 servers, 8 Erlangs — a published Erlang B table value.
    expect(erlangB(10, 8)).toBeCloseTo(0.12166, 4);
  });

  it("is zero-load safe and never returns NaN for a large c", () => {
    expect(erlangB(4, 0)).toBe(0);
    expect(Number.isFinite(erlangB(200, 150))).toBe(true);
  });
});

describe("erlangC", () => {
  it("reduces to ρ for a single server (M/M/1)", () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 12);
    expect(erlangC(1, 0.25)).toBeCloseTo(0.25, 12);
  });

  it("matches the M/M/2 closed form 2ρ²/(1+ρ)", () => {
    for (const rho of [0.1, 0.4, 0.5, 0.8, 0.95]) {
      const a = 2 * rho;
      expect(erlangC(2, a)).toBeCloseTo((2 * rho * rho) / (1 + rho), 10);
    }
  });

  it("matches published table values", () => {
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 12);
    expect(erlangC(3, 2)).toBeCloseTo(4 / 9, 12);
    expect(erlangC(10, 8)).toBeCloseTo(0.409, 3);
    expect(erlangC(20, 15)).toBeCloseTo(0.1604, 4);
  });

  it("reports certainty of waiting once the load reaches the servers", () => {
    // Not a large finite number: at a >= c the backlog grows without bound, and
    // this is exactly the regime the page exists to warn about.
    expect(erlangC(2, 2)).toBe(1);
    expect(erlangC(2, 3)).toBe(1);
    expect(erlangC(0, 1)).toBe(1);
  });

  it("is zero when nothing is offered", () => {
    expect(erlangC(2, 0)).toBe(0);
  });

  it("is monotonic in load and decreasing in servers", () => {
    expect(erlangC(4, 1)).toBeLessThan(erlangC(4, 2));
    expect(erlangC(4, 2)).toBeLessThan(erlangC(4, 3));
    expect(erlangC(4, 2)).toBeLessThan(erlangC(3, 2));
  });
});

describe("erlangCMeanWait", () => {
  it("matches the M/M/1 closed form Wq = ρ·S/(1−ρ)", () => {
    const S = 120; // seconds
    for (const rho of [0.25, 0.5, 0.9]) {
      expect(erlangCMeanWait(1, rho, S)).toBeCloseTo((rho * S) / (1 - rho), 8);
    }
  });

  it("matches C(c,a)·S/(c−a) for multiple servers", () => {
    const S = 200;
    expect(erlangCMeanWait(2, 1, S)).toBeCloseTo(((1 / 3) * S) / 1, 8);
    expect(erlangCMeanWait(3, 2, S)).toBeCloseTo(((4 / 9) * S) / 1, 8);
  });

  it("is infinite for an unstable queue and zero for an idle one", () => {
    expect(erlangCMeanWait(1, 1, 100)).toBe(Number.POSITIVE_INFINITY);
    expect(erlangCMeanWait(2, 5, 100)).toBe(Number.POSITIVE_INFINITY);
    expect(erlangCMeanWait(2, 0, 100)).toBe(0);
  });
});

describe("erlangCWaitPercentile", () => {
  it("inverts P(W > t) = C·exp(−(c−a)·t/S)", () => {
    const c = 3;
    const a = 2;
    const S = 240;
    const t = erlangCWaitPercentile(c, a, S, 0.9);
    // Feed t back through the survival function: 10% should still be waiting.
    const survival = erlangC(c, a) * Math.exp((-(c - a) * t) / S);
    expect(survival).toBeCloseTo(0.1, 10);
  });

  it("is exactly zero when fewer than 10% of jobs ever wait", () => {
    // C(4, 1.5) ≈ 0.0746 — more than 90% of arrivals find a free slot, so the
    // p90 wait is genuinely 0, not a small positive number.
    expect(erlangC(4, 1.5)).toBeLessThan(0.1);
    expect(erlangCWaitPercentile(4, 1.5, 3600, 0.9)).toBe(0);
  });

  it("is longer at a higher percentile and infinite when unstable", () => {
    expect(erlangCWaitPercentile(2, 1.8, 300, 0.95)).toBeGreaterThan(
      erlangCWaitPercentile(2, 1.8, 300, 0.5)
    );
    expect(erlangCWaitPercentile(2, 2, 300, 0.9)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("buildScenarios", () => {
  /**
   * 1.5 jobs/hour against a one-hour service time: a = 1.5 Erlangs. Chosen so
   * every row can be checked by hand against the reference values above.
   */
  const LAMBDA = 1.5;
  const SERVICE_SECONDS = 3600;

  it("recommends the smallest concurrency that clears the p90 target", () => {
    const { scenarios, recommendedServers } = buildScenarios(LAMBDA, SERVICE_SECONDS, 15);

    // c=1 unstable, c=2 p90 ≈ 3h 43m, c=3 p90 ≈ 34m, c=4 p90 = 0.
    expect(scenarios[0].stable).toBe(false);
    expect(scenarios[0].p90WaitSeconds).toBe(Number.POSITIVE_INFINITY);
    expect(scenarios[1].p90WaitSeconds).toBeCloseTo(13397.42, 1);
    expect(scenarios[2].p90WaitSeconds).toBeCloseTo(2069.34, 1);
    expect(scenarios[3].p90WaitSeconds).toBe(0);
    expect(recommendedServers).toBe(4);
  });

  it("moves the recommendation when the target moves", () => {
    // A 40-minute target is met at c=3 (p90 ≈ 34m); 15 minutes is not.
    expect(buildScenarios(LAMBDA, SERVICE_SECONDS, 40).recommendedServers).toBe(3);
    expect(buildScenarios(LAMBDA, SERVICE_SECONDS, 15).recommendedServers).toBe(4);
  });

  it("reports utilisation and offered load per row", () => {
    const { scenarios } = buildScenarios(LAMBDA, SERVICE_SECONDS, 15);
    for (const scenario of scenarios) {
      expect(scenario.offeredLoad).toBeCloseTo(1.5, 10);
      expect(scenario.utilisation).toBeCloseTo(1.5 / scenario.servers, 10);
    }
  });

  it("inverts ρ = λ·S/c at the safe ceiling for max sustainable volume", () => {
    const { scenarios } = buildScenarios(LAMBDA, SERVICE_SECONDS, 15);
    // One hour of service per job, so c slots sustain 0.8·c·24 videos a day.
    expect(scenarios[1].maxSustainablePerDay).toBeCloseTo(SAFE_UTILISATION * 2 * 24, 8);
    expect(scenarios[3].maxSustainablePerDay).toBeCloseTo(SAFE_UTILISATION * 4 * 24, 8);
  });

  it("survives having no measured traffic at all", () => {
    const { scenarios, recommendedServers } = buildScenarios(0, 0, 15);
    expect(recommendedServers).toBe(1);
    for (const scenario of scenarios) {
      expect(scenario.p90WaitSeconds).toBe(0);
      expect(scenario.maxSustainablePerDay).toBe(0);
      expect(Number.isNaN(scenario.utilisation)).toBe(false);
    }
  });
});

describe("parseTargetMinutes", () => {
  it("defaults, clamps and ignores nonsense", () => {
    expect(parseTargetMinutes(undefined)).toBe(DEFAULT_TARGET_MINUTES);
    expect(parseTargetMinutes("")).toBe(DEFAULT_TARGET_MINUTES);
    expect(parseTargetMinutes("abc")).toBe(DEFAULT_TARGET_MINUTES);
    expect(parseTargetMinutes("-5")).toBe(DEFAULT_TARGET_MINUTES);
    expect(parseTargetMinutes("30")).toBe(30);
    expect(parseTargetMinutes(["45", "9"])).toBe(45);
    // An admin typing a year of minutes gets a day, not a broken model.
    expect(parseTargetMinutes("999999")).toBe(24 * 60);
  });
});

describe("AdminCapacityService — measured inputs", () => {
  it("turns the busiest weekday-hour into a rate, and parses pg's strings", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("slot_counts")) {
        return [
          {
            dow: "1",
            hour: "20",
            jobs: "12",
            occurrences: "4",
            peak_per_hour: "3",
            total_jobs: "40",
            window_hours: "168",
          },
        ];
      }
      return [];
    });
    const service = new AdminCapacityService(db);

    const arrivals = await service.getArrivalProfile(RANGE);

    expect(arrivals.peakPerHour).toBe(3);
    expect(arrivals.peakDayOfWeek).toBe(1);
    expect(arrivals.peakHour).toBe(20);
    expect(arrivals.peakOccurrences).toBe(4);
    expect(arrivals.totalJobs).toBe(40);
    expect(arrivals.meanPerHour).toBeCloseTo(40 / 168, 10);

    const sql = flat(db.calls[0].text);
    // Bucketing must be Bangkok-local on both sides of the join, or the peak
    // slot is compared against the wrong occurrence count.
    expect(sql).toContain("EXTRACT(DOW FROM slot AT TIME ZONE 'Asia/Bangkok')");
    expect(sql).toContain("EXTRACT(DOW FROM arrived_at AT TIME ZONE 'Asia/Bangkok')");
    // One arrival per JOB, not per task: a video enqueues several heavy steps.
    expect(sql).toContain("MIN(enqueued_at) AS arrived_at");
  });

  it("returns an empty profile rather than NaN when nothing was enqueued", async () => {
    const service = new AdminCapacityService(stubDb());
    const arrivals = await service.getArrivalProfile(RANGE);

    expect(arrivals).toEqual({
      peakPerHour: 0,
      meanPerHour: 0,
      peakDayOfWeek: null,
      peakHour: null,
      peakOccurrences: 0,
      peakJobs: 0,
      totalJobs: 0,
    });
  });

  it("sums render-task durations per job before averaging", async () => {
    const db = stubDb((sql) =>
      sql.includes("per_job")
        ? [
            {
              jobs: "10",
              tasks: "63",
              mean_seconds: "185.25",
              median_seconds: "170",
              p90_seconds: "320.5",
            },
          ]
        : []
    );
    const service = new AdminCapacityService(db);

    const service_ = await service.getServiceProfile(RANGE);

    expect(service_.meanSecondsPerJob).toBeCloseTo(185.25, 6);
    expect(service_.jobs).toBe(10);
    expect(service_.tasks).toBe(63);

    const sql = flat(db.calls[0].text);
    // Per job, then averaged — averaging steps would answer a different question.
    expect(sql).toContain("SUM(duration_ms)::float8 / 1000.0 AS job_seconds");
    expect(sql).toContain("GROUP BY job_id");
    // Failed tasks burned CPU but their duration is a give-up time, not service.
    expect(sql).toContain("state = 'done'");
  });

  it("counts a task as in-system until it finishes, not until it goes quiet", async () => {
    const db = stubDb(() => []);
    const service = new AdminCapacityService(db);

    await service.getDepthBuckets(RANGE);

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("COALESCE(o.finished_at, o.heartbeat_at, o.updated_at)");
    expect(sql).toContain("o.enqueued_at <= t.enqueued_at");
    // The top bucket is open-ended so a rare 40-deep queue does not become its
    // own single-sample row.
    expect(db.calls[0].values[2]).toBe(5);
  });
});

describe("AdminCapacityService — Little's Law", () => {
  const littlesRows = (sql: string): Record<string, unknown>[] => {
    if (sql.includes("mean_system_seconds")) {
      // 168 tasks over a 168-hour week = 1 task/hour; W = 30 min → λ·W = 0.5.
      return [{ tasks: "168", mean_system_seconds: "1800" }];
    }
    if (sql.includes("observed_in_system")) {
      return [{ samples: "10080", observed_in_system: "0.55" }];
    }
    if (sql.includes("NOT EXISTS")) return [{ jobs: "3" }];
    return [];
  };

  it("computes λ, W and L from independent sources and reports the gap", async () => {
    const service = new AdminCapacityService(stubDb(littlesRows));

    const check = await service.getLittlesLaw(RANGE);

    expect(check.arrivalsPerHour).toBeCloseTo(1, 10);
    expect(check.meanTimeInSystemSeconds).toBe(1800);
    expect(check.predictedInSystem).toBeCloseTo(0.5, 10);
    // Observed comes from sampled queue_depth, not from the same rows as λ and W.
    expect(check.observedInSystem).toBeCloseTo(0.55, 10);
    expect(check.relativeGap).toBeCloseTo(Math.abs(0.5 - 0.55) / 0.55, 10);
    expect(check.jobsWithoutRenderTasks).toBe(3);
  });

  it("uses sampled queue_depth ALONE — adding active_tasks double-counts claims", async () => {
    const db = stubDb(littlesRows);
    const service = new AdminCapacityService(db);

    await service.getLittlesLaw(RANGE);

    const sampleSql = sqlOf(db).find((sql) => sql.includes("observed_in_system"));
    expect(sampleSql).toContain("AVG(queue_depth)");
    // queue_depth is already queued + claimed, platform-wide.
    expect(sampleSql).not.toContain("active_tasks");
  });

  it("reports no comparison rather than a false agreement when nothing was sampled", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("observed_in_system")) return [{ samples: "0", observed_in_system: null }];
      return littlesRows(sql);
    });
    const service = new AdminCapacityService(db);

    const check = await service.getLittlesLaw(RANGE);

    expect(check.observedInSystem).toBeNull();
    expect(check.relativeGap).toBeNull();
    // λ and W are still real measurements, so they are still reported.
    expect(check.predictedInSystem).toBeCloseTo(0.5, 10);
  });

  it("casts the job id when looking for inline-fallback jobs", async () => {
    const db = stubDb(littlesRows);
    const service = new AdminCapacityService(db);

    await service.getLittlesLaw(RANGE);

    const inlineSql = sqlOf(db).find((sql) => sql.includes("NOT EXISTS"));
    // clip/job ids are uuid in one environment and text in the other.
    // Both sides cast: render_tasks.job_id is TEXT, but video_generation_jobs.id
    // is uuid in some deployments, and a one-sided cast raises 42883 there.
    expect(inlineSql).toContain("r.job_id::text = j.id::text");
  });
});

describe("AdminCapacityService — report assembly", () => {
  it("flags missing worker sampling instead of inventing a series", async () => {
    const service = new AdminCapacityService(stubDb());

    const report = await service.getReport(RANGE);

    expect(report.samplingUnavailable).toBe(true);
    expect(report.workerLoad).toEqual([]);
    expect(report.littlesLaw.observedInSystem).toBeNull();
  });

  it("models at least one render slot even with no worker on record", async () => {
    const service = new AdminCapacityService(stubDb());

    const report = await service.getReport(RANGE);

    // No worker has claimed anything yet, so utilisation must not divide by zero.
    expect(report.model.workerCount).toBe(0);
    expect(report.model.currentServers).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(report.model.utilisation)).toBe(true);
    expect(report.model.targetMinutes).toBe(DEFAULT_TARGET_MINUTES);
  });

  it("buckets worker load and queue wait by Bangkok day, on separate series", async () => {
    const db = stubDb((sql) => {
      if (sql.includes("render_worker_samples") && sql.includes("avg_cpu")) {
        return [
          {
            date: "2026-07-02",
            avg_cpu: "41.5",
            peak_cpu: "98.2",
            avg_load: "2.1",
            avg_queue_depth: "0.8",
            peak_queue_depth: "4",
            avg_active: "0.6",
            samples: "1440",
          },
        ];
      }
      if (sql.includes("median_wait")) {
        return [{ date: "2026-07-02", tasks: "22", median_wait: "12.5", p90_wait: "310" }];
      }
      return [];
    });
    const service = new AdminCapacityService(db);

    const report = await service.getReport(RANGE, 20);

    expect(report.samplingUnavailable).toBe(false);
    expect(report.workerLoad[0]).toEqual({
      date: "2026-07-02",
      avgCpuPercent: 41.5,
      peakCpuPercent: 98.2,
      avgLoad1m: 2.1,
      avgQueueDepth: 0.8,
      peakQueueDepth: 4,
      avgActiveTasks: 0.6,
      samples: 1440,
    });
    expect(report.queueWait[0].p90WaitSeconds).toBe(310);
    expect(report.model.targetMinutes).toBe(20);

    for (const sql of sqlOf(db).filter((s) => s.includes("TO_CHAR"))) {
      expect(sql).toContain("AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'");
    }
  });
});
