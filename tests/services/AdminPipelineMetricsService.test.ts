import { PROCESSING_STEP_TIMEOUT_SECONDS } from "@/config/stallThresholds";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { RenderStep } from "@/domain/enums/RenderStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { RenderTask } from "@/domain/models/RenderTask";
import type { RenderQueueSnapshot } from "@/services/admin/AdminDashboardService";
import {
  AdminPipelineMetricsService,
  PIPELINE_STEP_RENDER_STEPS,
  formatDuration,
  humaniseStep,
  isGateStep,
  summariseQueue,
} from "@/services/admin/AdminPipelineMetricsService";

/**
 * Pipeline timing (`render_tasks` + `video_generation_step_history`).
 *
 * The things a mistake would make quietly wrong here:
 *
 *   - `pg` returns COUNT/BIGINT/NUMERIC as STRINGS, and `percentile_cont` comes
 *     back as a NUMERIC string too. A p90 that is a string sorts and formats
 *     without complaint and is simply wrong;
 *   - the step-history de-dup. The history write guard is
 *     `currentStep !== undefined`, not "the value changed", so consecutive
 *     identical rows exist. Running LEAD over the raw rows measures the gap
 *     between two writes of the same step — milliseconds — and reports every
 *     step as instant. The de-dup MUST happen before the LEAD;
 *   - the inline-fallback counter, which is the only visibility into heavy
 *     steps that ran on the web server and wrote no queue row at all;
 *   - the stall thresholds coming from the config rather than being restated.
 *
 * The de-dup and the percentile maths run inside Postgres, so the assertions on
 * those are necessarily structural — the query shape is what is under test, and
 * a stub pool cannot execute a window function. Everything computed in
 * TypeScript is tested behaviourally.
 *
 * The pool is constructor-injected (the `ManagementAuditService` pattern), so a
 * stub is enough — no live Postgres.
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

const FROM = new Date("2026-07-01T17:00:00Z");
const TO = new Date("2026-08-16T17:00:00Z");

function task(overrides: Partial<RenderTask> = {}): RenderTask {
  return {
    id: "task-1",
    jobId: "job-1",
    requestId: "req-1",
    requesterId: "user-1",
    step: RenderStep.FfmpegComposition,
    payload: null,
    state: "queued",
    attempts: 0,
    enqueuedAt: new Date("2026-08-16T10:00:00Z"),
    claimedBy: null,
    claimedAt: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    error: null,
    createdAt: new Date("2026-08-16T10:00:00Z"),
    updatedAt: new Date("2026-08-16T10:00:00Z"),
    ...overrides,
  };
}

describe("numeric-string parsing", () => {
  it("parses every count and percentile that pg hands over as a string", async () => {
    const db = stubDb(() => [
      {
        step: "ffmpeg_composition",
        total: "20",
        claimed: "18",
        finished: "16",
        failed: "5",
        avg_attempts: "1.25",
        wait_mean: "45000.5",
        wait_p50: "30000",
        wait_p90: "120000",
        wait_max: "3600000",
        run_mean: "960000",
        run_p50: "900000",
        run_p90: "1500000",
        run_max: "1800000",
      },
    ]);

    const [row] = await new AdminPipelineMetricsService(db).getRenderStepStats(
      FROM,
      TO
    );

    expect(row.total).toBe(20);
    expect(row.avgAttempts).toBeCloseTo(1.25);
    expect(row.wait.median).toBe(30000);
    expect(row.run.p90).toBe(1500000);
    expect(typeof row.run.p90).toBe("number");
    // 5 of 20, computed in TS — string division would have produced NaN.
    expect(row.failureRatePct).toBeCloseTo(25);
  });

  it("keeps 'no sample' as null rather than collapsing it to zero", async () => {
    // An unclaimed, unfinished step has no wait and no run. Zero would read as
    // "instant"; null renders as an em dash.
    const db = stubDb(() => [
      {
        step: "travy_generation",
        total: "3",
        claimed: "0",
        finished: "0",
        failed: "0",
        avg_attempts: "0",
        wait_mean: null,
        wait_p50: null,
        wait_p90: null,
        wait_max: null,
        run_mean: null,
        run_p50: null,
        run_p90: null,
        run_max: null,
      },
    ]);

    const [row] = await new AdminPipelineMetricsService(db).getRenderStepStats(
      FROM,
      TO
    );

    expect(row.wait.median).toBeNull();
    expect(row.run.max).toBeNull();
    expect(row.failureRatePct).toBe(0);
    expect(formatDuration(row.wait.median)).toBe("—");
  });

  it("parses dwell statistics and flags the review gates", async () => {
    const db = stubDb(() => [
      {
        step: "analyzing_content",
        samples: "12",
        dwell_mean: "42000",
        dwell_p50: "38000",
        dwell_p90: "61000",
        dwell_max: "95000",
      },
      {
        step: "awaiting_content_approval",
        samples: "12",
        dwell_mean: "86400000",
        dwell_p50: "3600000",
        dwell_p90: "172800000",
        dwell_max: "604800000",
      },
    ]);

    const rows = await new AdminPipelineMetricsService(db).getPipelineStepStats(
      FROM,
      TO
    );

    expect(rows[0].isGate).toBe(false);
    expect(rows[0].dwell.median).toBe(38000);
    // Gate dwell is user thinking time; the page lists it in its own table so a
    // single overnight approval cannot swamp the render figures.
    expect(rows[1].isGate).toBe(true);
    expect(rows[1].samples).toBe(12);
  });
});

describe("consecutive-duplicate de-dup in the step-history query", () => {
  it("collapses repeated steps BEFORE taking the LEAD", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getPipelineStepStats(FROM, TO);

    const sql = flat(db.calls[0].text);

    // The write guard is `currentStep !== undefined`, so any update carrying the
    // current step appends another identical row. LEAD over the raw rows would
    // measure the interval between two writes of the SAME step.
    expect(sql).toContain("LAG(s.step) OVER (PARTITION BY s.job_id ORDER BY s.created_at, s.id)");
    expect(sql).toContain("prev_step IS DISTINCT FROM step");
    expect(sql).toContain("LEAD(d.created_at) OVER (PARTITION BY d.job_id ORDER BY d.created_at)");

    // Order matters more than presence: the de-dup must be upstream of the LEAD.
    expect(sql.indexOf("prev_step IS DISTINCT FROM step")).toBeLessThan(
      sql.indexOf("LEAD(d.created_at)")
    );
    // ...and the LEAD must read the DEDUPED relation, not the raw history.
    expect(sql).toContain("FROM deduped d");
  });

  it("uses id as the ordering tiebreaker so the de-dup is deterministic", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getPipelineStepStats(FROM, TO);

    // Two rows can share a timestamp; without a stable second key the de-dup
    // would depend on scan order and the result would flap between runs.
    expect(flat(db.calls[0].text)).toContain("ORDER BY s.created_at, s.id");
  });

  it("widens the scan to each job's full history so the last span is not lost", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getPipelineStepStats(FROM, TO);

    const sql = flat(db.calls[0].text);
    // LEAD needs the row AFTER the last in-range one, or every job's final step
    // in the window looks open-ended and is dropped. The range filter therefore
    // applies to the SPANS, not to the rows the window function reads.
    expect(sql).toContain("WHERE h.job_id IN ( SELECT DISTINCT j.job_id");
    expect(sql).toContain("WHERE dwell_ms IS NOT NULL AND created_at >= $1");
  });

  it("applies the same de-dup to the inline-fallback counter", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getInlineFallbacks(FROM, TO);

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("prev_step IS DISTINCT FROM step");
    // Without it, one transition that was written three times would be counted
    // as three inline fallbacks.
    expect(sql).toContain("COUNT(*) FILTER (WHERE NOT EXISTS");
  });
});

describe("inline-fallback counter", () => {
  it("counts transitions with no render_tasks row and reports the share", async () => {
    const db = stubDb(() => [
      { step: "composing_final_video", transitions: "40", inline: "10" },
      { step: "generating_overlay", transitions: "35", inline: "5" },
    ]);

    const report = await new AdminPipelineMetricsService(db).getInlineFallbacks(
      FROM,
      TO
    );

    expect(report.totalTransitions).toBe(75);
    expect(report.totalInline).toBe(15);
    expect(report.inlineSharePct).toBeCloseTo(20);
  });

  it("returns zero rather than NaN when nothing entered a heavy step", async () => {
    const report = await new AdminPipelineMetricsService(stubDb(() => []))
      .getInlineFallbacks(FROM, TO);

    expect(report.rows).toEqual([]);
    expect(report.inlineSharePct).toBe(0);
  });

  it("passes a pipeline-step → render-step map built from the shared table", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getInlineFallbacks(FROM, TO);

    const [, , pipelineSteps, renderSteps] = db.calls[0].values as [
      Date,
      Date,
      string[],
      string[],
    ];

    expect(pipelineSteps).toHaveLength(renderSteps.length);
    // Both montage render steps map onto the same pipeline step, so the pairing
    // has to be a list of pairs rather than a one-to-one lookup.
    const pairs = pipelineSteps.map((step, i) => `${step}->${renderSteps[i]}`);
    expect(pairs).toContain(
      `${VideoGenerationStep.GeneratingBaseVideo}->${RenderStep.MontageAllSegments}`
    );
    expect(pairs).toContain(
      `${VideoGenerationStep.GeneratingBaseVideo}->${RenderStep.MontageSceneSegment}`
    );
    expect(pairs).toContain(
      `${VideoGenerationStep.ComposingFinalVideo}->${RenderStep.FfmpegComposition}`
    );
  });

  it("leaves Travy out of the map", () => {
    // Its RENDER_STEP_FAILED_AT entry is a placeholder for type completeness —
    // the step is soft-failing and runs during awaiting_distribution_review, so
    // treating it as a pipeline step would report every finished job as an
    // inline fallback.
    const mapped = Object.values(PIPELINE_STEP_RENDER_STEPS).flatMap((v) => v ?? []);
    expect(mapped).not.toContain(RenderStep.TravyGeneration);
    expect(
      PIPELINE_STEP_RENDER_STEPS[VideoGenerationStep.AwaitingDistributionReview]
    ).toBeUndefined();
  });

  it("casts both sides of the job_id join to text", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getInlineFallbacks(FROM, TO);

    // video_generation_jobs.id is uuid in some environments and text in others
    // (migration 005), and neither job_id column carries an FK.
    expect(flat(db.calls[0].text)).toContain("rt.job_id::text = d.job_id::text");
  });
});

describe("stall watch", () => {
  it("takes its thresholds from the shared config, in step order", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getStalledJobs();

    const [steps, timeouts, status, staleSeconds] = db.calls[0].values as [
      string[],
      number[],
      string,
      number,
    ];

    // Reused, never restated — the config already explains why compose gets the
    // widest window.
    expect(steps).toEqual(Object.keys(PROCESSING_STEP_TIMEOUT_SECONDS));
    steps.forEach((step, i) => {
      expect(timeouts[i]).toBe(
        PROCESSING_STEP_TIMEOUT_SECONDS[step as VideoGenerationStep]
      );
    });
    expect(timeouts[steps.indexOf(VideoGenerationStep.ComposingFinalVideo)]).toBe(
      25 * 60
    );
    expect(status).toBe(VideoGenerationJobStatus.Active);
    expect(staleSeconds).toBe(RENDER_QUEUE.staleClaimSeconds);
  });

  it("maps a stalled row, keeping the live-worker distinction", async () => {
    const db = stubDb(() => [
      {
        job_id: "job-9",
        request_id: "req-9",
        request_title: "Cafe opening",
        step: "composing_final_video",
        stalled_for_ms: "1860000",
        threshold_ms: "1500000",
        worker_active: true,
      },
      {
        job_id: "job-10",
        request_id: "req-10",
        request_title: null,
        step: "generating_voice",
        stalled_for_ms: "420000",
        threshold_ms: "300000",
        worker_active: false,
      },
    ]);

    const rows = await new AdminPipelineMetricsService(db).getStalledJobs();

    expect(rows[0].stalledForMs).toBe(1860000);
    // "Long but alive" is the interesting case, so it is a column rather than a
    // filter — mirroring isJobStalled's carve-out for a fresh keep-alive.
    expect(rows[0].workerActive).toBe(true);
    expect(rows[1].workerActive).toBe(false);
    expect(rows[1].requestTitle).toBeNull();
  });
});

describe("live queue summary", () => {
  const snapshot = (partial: Partial<RenderQueueSnapshot>): RenderQueueSnapshot => ({
    workerOnline: true,
    tasks: [],
    ...partial,
  });

  it("counts queued and claimed separately and ages only the queued ones", () => {
    const now = new Date("2026-08-16T10:10:00Z").getTime();

    const summary = summariseQueue(
      snapshot({
        tasks: [
          task({
            id: "a",
            state: "claimed",
            step: RenderStep.MontageMerge,
            enqueuedAt: new Date("2026-08-16T09:00:00Z"),
          }),
          task({
            id: "b",
            state: "queued",
            step: RenderStep.OverlayComposition,
            enqueuedAt: new Date("2026-08-16T10:05:00Z"),
          }),
          task({
            id: "c",
            state: "queued",
            step: RenderStep.AdditionalRatios,
            enqueuedAt: new Date("2026-08-16T10:02:00Z"),
          }),
        ],
      }),
      now
    );

    expect(summary.claimed).toBe(1);
    expect(summary.queued).toBe(2);
    // The claimed task is the oldest by enqueue time, but it is being worked on
    // — calling its age "queue wait" would turn a long render into a backlog.
    expect(summary.oldestWaitingStep).toBe(RenderStep.AdditionalRatios);
    expect(summary.oldestWaitingMs).toBe(8 * 60 * 1000);
  });

  it("reports no wait when the line is empty", () => {
    const summary = summariseQueue(snapshot({ workerOnline: false }));

    expect(summary.queued).toBe(0);
    expect(summary.oldestWaitingMs).toBeNull();
    expect(summary.oldestWaitingStep).toBeNull();
    expect(summary.workerOnline).toBe(false);
  });
});

describe("presentation helpers", () => {
  it("never shows raw milliseconds", () => {
    expect(formatDuration(1400)).toBe("1.4s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(150_000)).toBe("2m 30s");
    expect(formatDuration(4_320_000)).toBe("1h 12m");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("classifies every awaiting_* enum member as a gate and nothing else", () => {
    for (const step of Object.values(VideoGenerationStep)) {
      expect(isGateStep(step)).toBe(step.startsWith("awaiting_"));
    }
  });

  it("keeps the raw step name recognisable in the English label", () => {
    // PIPELINE_STEP_LABELS is Thai and written for the requester; this surface
    // is an English admin tool, and the label has to survive being grepped for
    // in the worker log.
    expect(humaniseStep("analyzing_content")).toBe("Analyzing content");
    expect(humaniseStep("ffmpeg_composition")).toBe("Ffmpeg composition");
  });
});

describe("render-step query shape", () => {
  it("measures wait from claimed_at - enqueued_at and run from duration_ms", async () => {
    const db = stubDb(() => []);
    await new AdminPipelineMetricsService(db).getRenderStepStats(FROM, TO);

    const sql = flat(db.calls[0].text);
    expect(sql).toContain("rt.claimed_at - rt.enqueued_at");
    // Not finished_at - started_at: that would also count the worker's own
    // bookkeeping around the render.
    expect(sql).not.toContain("rt.finished_at - rt.started_at");
    expect(sql).toContain("percentile_cont(0.5) WITHIN GROUP (ORDER BY rt.duration_ms)");
    expect(sql).toContain("percentile_cont(0.9) WITHIN GROUP (ORDER BY rt.duration_ms)");
    expect(db.calls[0].values).toEqual([FROM, TO]);
  });
});
