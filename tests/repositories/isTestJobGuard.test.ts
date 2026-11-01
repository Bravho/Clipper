/**
 * is_test job isolation guards.
 *
 * Verifies that:
 * 1. In LINE test mode, enqueue uses 'test_queued' state so old Mac Mini SQL
 *    (which only selects state='queued') cannot see test jobs.
 * 2. In LINE test mode, claimNext claims only 'test_queued'/'test_claimed' tasks.
 * 3. In non-test mode, claimNext is blind to 'test_queued'/'test_claimed' tasks.
 * 4. enqueue is DO NOTHING: returns existing active task unchanged when conflict.
 * 5. Test-mode release restores to 'test_queued', not 'queued'.
 * 6. MockVideoGenerationJobRepository.claimNextQueuedRenderStep honours is_test guard.
 */

import { MockRenderTaskRepository } from "@/repositories/mock/MockRenderTaskRepository";
import { MockVideoGenerationJobRepository } from "@/repositories/mock/MockVideoGenerationJobRepository";
import { RenderTask } from "@/domain/models/RenderTask";
import { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { RenderStep } from "@/domain/enums/RenderStep";

afterEach(() => {
  delete process.env.LINE_TEST_MODE;
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRepo() {
  return new MockRenderTaskRepository(new Map<string, RenderTask>());
}

function makeJobRepo() {
  return new MockVideoGenerationJobRepository(new Map<string, VideoGenerationJob>());
}

async function baseJob(
  repo: MockVideoGenerationJobRepository,
  overrides: Record<string, unknown> = {}
): Promise<VideoGenerationJob> {
  return repo.create({
    requestId: "req-1",
    status: VideoGenerationJobStatus.Active,
    currentStep: VideoGenerationStep.GeneratingBaseVideo,
    currentSceneIndex: 0,
    rvcVoiceModel: "",
    subtitleLanguages: ["en"],
    renderState: "queued",
    ...overrides,
  } as Parameters<typeof repo.create>[0]);
}

// ── render_tasks: enqueue DO NOTHING ────────────────────────────────────────

describe("render_tasks enqueue DO NOTHING", () => {
  it("returns existing active task if already queued (no reset)", async () => {
    const repo = makeRepo();
    const first = await repo.enqueue({
      jobId: "j", requestId: "r", step: RenderStep.MontageMerge,
    });
    const second = await repo.enqueue({
      jobId: "j", requestId: "r", step: RenderStep.OverlayComposition,
    });
    expect(second.id).toBe(first.id);
    expect(second.step).toBe(RenderStep.MontageMerge); // original unchanged
    const active = await repo.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].step).toBe(RenderStep.MontageMerge);
  });

  it("creates a new task after the previous one completed (no conflict)", async () => {
    const repo = makeRepo();
    const first = await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.MontageMerge });
    await repo.complete(first.id, "done");
    const second = await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.OverlayComposition });
    expect(second.id).not.toBe(first.id);
    expect(second.step).toBe(RenderStep.OverlayComposition);
  });

  it("returns existing test task if already test_queued (DO NOTHING in test mode)", async () => {
    process.env.LINE_TEST_MODE = "true";
    const repo = makeRepo();
    const first = await repo.enqueue({ jobId: "j-t", requestId: "r", step: RenderStep.MontageMerge });
    expect(first.state).toBe("test_queued");
    const second = await repo.enqueue({ jobId: "j-t", requestId: "r", step: RenderStep.OverlayComposition });
    expect(second.id).toBe(first.id);
    expect(second.state).toBe("test_queued");
    expect(second.step).toBe(RenderStep.MontageMerge);
  });
});

// ── render_tasks: test mode isolation ───────────────────────────────────────

describe("render_tasks test mode isolation", () => {
  it("non-test worker cannot see test_queued tasks", async () => {
    process.env.LINE_TEST_MODE = "true";
    const repo = makeRepo();
    await repo.enqueue({ jobId: "test-job", requestId: "r", step: RenderStep.MontageMerge });
    expect((await repo.listActive())[0].state).toBe("test_queued");

    // Switch to non-test mode — worker cannot see those tasks
    delete process.env.LINE_TEST_MODE;
    expect(await repo.claimNext("mac-mini", 600)).toBeNull();
    expect(await repo.listActive()).toHaveLength(0);
    expect(await repo.findActiveByJob("test-job")).toBeNull();
  });

  it("test worker cannot see production queued tasks", async () => {
    const repo = makeRepo();
    await repo.enqueue({ jobId: "prod-job", requestId: "r", step: RenderStep.MontageMerge });

    process.env.LINE_TEST_MODE = "true";
    expect(await repo.claimNext("mar-pc", 600)).toBeNull();
    expect(await repo.listActive()).toHaveLength(0);
    expect(await repo.findActiveByJob("prod-job")).toBeNull();
  });

  it("test worker claims test_queued task and transitions to test_claimed", async () => {
    process.env.LINE_TEST_MODE = "true";
    const repo = makeRepo();
    await repo.enqueue({ jobId: "t-job", requestId: "r", step: RenderStep.FfmpegComposition });

    const claimed = await repo.claimNext("mar-pc", 600);
    expect(claimed).not.toBeNull();
    expect(claimed!.state).toBe("test_claimed");
    expect(claimed!.claimedBy).toBe("mar-pc");
  });

  it("test worker reclaims stale test_claimed tasks", async () => {
    process.env.LINE_TEST_MODE = "true";
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    await repo.enqueue({ jobId: "t-job", requestId: "r", step: RenderStep.MontageMerge });

    const first = await repo.claimNext("mar-pc-1", 600);
    expect(first!.state).toBe("test_claimed");
    // Backdate heartbeat to make it stale
    store.get(first!.id)!.heartbeatAt = new Date(Date.now() - 700_000);

    const reclaimed = await repo.claimNext("mar-pc-2", 600);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.id).toBe(first!.id);
    expect(reclaimed!.state).toBe("test_claimed");
    expect(reclaimed!.claimedBy).toBe("mar-pc-2");
    expect(reclaimed!.attempts).toBe(2);
  });

  it("non-test worker stale-reclaim path cannot grab test_claimed tasks", async () => {
    process.env.LINE_TEST_MODE = "true";
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    await repo.enqueue({ jobId: "t", requestId: "r", step: RenderStep.MontageMerge });
    const claimed = await repo.claimNext("mar-pc", 600);
    // Backdate to simulate stale claim
    store.get(claimed!.id)!.heartbeatAt = new Date(0);
    store.get(claimed!.id)!.claimedAt = new Date(0);

    // Switch to non-test mode: should NOT reclaim the test_claimed task
    delete process.env.LINE_TEST_MODE;
    const result = await repo.claimNext("mac-mini", 600);
    expect(result).toBeNull();
  });

  it("release in test mode restores to test_queued (not queued)", async () => {
    process.env.LINE_TEST_MODE = "true";
    const repo = makeRepo();
    await repo.enqueue({ jobId: "t-rel", requestId: "r", step: RenderStep.MontageMerge });
    const claimed = await repo.claimNext("mar-pc", 600);
    expect(claimed!.state).toBe("test_claimed");

    await repo.release(claimed!.id);
    const task = (await repo.listActive())[0];
    expect(task.state).toBe("test_queued");
    // Non-test worker still cannot see it after release
    delete process.env.LINE_TEST_MODE;
    expect(await repo.claimNext("mac-mini", 600)).toBeNull();
  });
});

// ── render_tasks: Postgres SQL content (integration-level check via mock DB) ─

describe("PostgresRenderTaskRepository SQL content (via mock db)", () => {
  beforeEach(() => jest.resetModules());

  it("enqueue SQL contains DO NOTHING and no DO UPDATE in non-test mode", async () => {
    jest.mock("@/lib/db", () => ({ pool: {} }));
    const { PostgresRenderTaskRepository } = await import(
      "@/repositories/postgres/PostgresRenderTaskRepository"
    );
    const query = jest.fn().mockResolvedValue({ rows: [{ id: "x" }] });
    const repo = new PostgresRenderTaskRepository({ query } as never);
    await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.MontageMerge });
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("DO NOTHING");
    expect(sql).not.toContain("DO UPDATE");
    expect(sql).toContain("state IN ('queued', 'claimed')");
  });

  it("enqueue SQL uses test_queued state in LINE_TEST_MODE", async () => {
    process.env.LINE_TEST_MODE = "true";
    jest.mock("@/lib/db", () => ({ pool: {} }));
    const { PostgresRenderTaskRepository } = await import(
      "@/repositories/postgres/PostgresRenderTaskRepository"
    );
    const query = jest.fn().mockResolvedValue({ rows: [{ id: "x" }] });
    const repo = new PostgresRenderTaskRepository({ query } as never);
    await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.MontageMerge });
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("'test_queued'");
    expect(sql).toContain("state IN ('test_queued', 'test_claimed')");
    expect(sql).toContain("DO NOTHING");
    expect(sql).not.toContain("DO UPDATE");
  });

  it("non-test claimNext SQL only selects state='queued', not test_queued", async () => {
    jest.mock("@/lib/db", () => ({ pool: {} }));
    const { PostgresRenderTaskRepository } = await import(
      "@/repositories/postgres/PostgresRenderTaskRepository"
    );
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresRenderTaskRepository({ query } as never);
    await repo.claimNext("mac-mini", 60);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("state = 'queued'");
    expect(sql).not.toContain("test_queued");
    expect(sql).not.toContain("test_claimed");
  });

  it("test-mode claimNext SQL selects test_queued and updates to test_claimed", async () => {
    process.env.LINE_TEST_MODE = "true";
    jest.mock("@/lib/db", () => ({ pool: {} }));
    const { PostgresRenderTaskRepository } = await import(
      "@/repositories/postgres/PostgresRenderTaskRepository"
    );
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repo = new PostgresRenderTaskRepository({ query } as never);
    await repo.claimNext("mar-pc", 60);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("state = 'test_queued'");
    expect(sql).toContain("state = 'test_claimed'");
    expect(sql).toContain("state        = 'test_claimed'");
    expect(sql).not.toContain("state = 'queued'");
    expect(sql).not.toContain("state       = 'claimed'");
  });
});

// ── MockVideoGenerationJobRepository: claimNextQueuedRenderStep guard ────────

describe("MockVideoGenerationJobRepository.claimNextQueuedRenderStep is_test guard", () => {
  it("non-test mode does not claim a job flagged isTest=true", async () => {
    const repo = makeJobRepo();
    const job = await baseJob(repo);
    // Manually mark as test job (simulates what Postgres JOIN checks on is_test)
    (repo as unknown as { store: Map<string, VideoGenerationJob> })["store"].set(
      job.id, { ...job, renderState: "queued", isTest: true } as VideoGenerationJob & { isTest: boolean }
    );
    const claimed = await repo.claimNextQueuedRenderStep("mac-mini", 600);
    expect(claimed).toBeNull();
  });

  it("test mode does not claim a job without isTest=true", async () => {
    process.env.LINE_TEST_MODE = "true";
    const repo = makeJobRepo();
    await baseJob(repo);
    const claimed = await repo.claimNextQueuedRenderStep("mar-pc", 600);
    expect(claimed).toBeNull();
  });

  it("test mode claims a job with isTest=true", async () => {
    process.env.LINE_TEST_MODE = "true";
    const repo = makeJobRepo();
    const job = await baseJob(repo);
    (repo as unknown as { store: Map<string, VideoGenerationJob> })["store"].set(
      job.id, { ...job, renderState: "queued", isTest: true } as VideoGenerationJob & { isTest: boolean }
    );
    const claimed = await repo.claimNextQueuedRenderStep("mar-pc", 600);
    expect(claimed).not.toBeNull();
    expect(claimed!.renderState).toBe("claimed");
  });

  it("non-test mode claims a normal job without isTest flag", async () => {
    const repo = makeJobRepo();
    await baseJob(repo);
    const claimed = await repo.claimNextQueuedRenderStep("mac-mini", 600);
    expect(claimed).not.toBeNull();
  });
});
