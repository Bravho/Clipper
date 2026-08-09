import { MockRenderTaskRepository } from "@/repositories/mock/MockRenderTaskRepository";
import { RenderTask } from "@/domain/models/RenderTask";
import { RenderStep } from "@/domain/enums/RenderStep";

/**
 * Flat FIFO render-task queue (Mac Mini worker). Validates the ordering,
 * atomic-claim, stale-reclaim and honest-position contract the worker and the
 * web-side dispatch seam depend on, against the Mock repo (mirrors the Postgres
 * SQL). The queue is ONE line mixed across requesters — e.g. #1 user B's
 * overlay, #2 user A's merge — so a requester only ever needs a position count.
 */

/** Backdate a task's FIFO key so ordering is deterministic in tests. */
function backdateEnqueue(
  store: Map<string, RenderTask>,
  id: string,
  msAgo: number
): void {
  const t = store.get(id)!;
  t.enqueuedAt = new Date(Date.now() - msAgo);
}

describe("render-task FIFO queue", () => {
  it("claims tasks oldest-first across different requesters and steps", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);

    // Enqueue out of intended order, then backdate to fix a strict FIFO order:
    // B/overlay (oldest) → A/merge → C/compose (newest).
    const a = await repo.enqueue({
      jobId: "job-A",
      requestId: "req-A",
      requesterId: "user-A",
      step: RenderStep.MontageMerge,
    });
    const b = await repo.enqueue({
      jobId: "job-B",
      requestId: "req-B",
      requesterId: "user-B",
      step: RenderStep.OverlayComposition,
    });
    const c = await repo.enqueue({
      jobId: "job-C",
      requestId: "req-C",
      requesterId: "user-C",
      step: RenderStep.FfmpegComposition,
    });
    backdateEnqueue(store, b.id, 3000);
    backdateEnqueue(store, a.id, 2000);
    backdateEnqueue(store, c.id, 1000);

    const first = await repo.claimNext("mac-1", 600);
    expect(first?.id).toBe(b.id);
    expect(first?.requesterId).toBe("user-B");
    expect(first?.step).toBe(RenderStep.OverlayComposition);
    await repo.complete(first!.id, "done");

    const second = await repo.claimNext("mac-1", 600);
    expect(second?.id).toBe(a.id);
    expect(second?.step).toBe(RenderStep.MontageMerge);
    await repo.complete(second!.id, "done");

    const third = await repo.claimNext("mac-1", 600);
    expect(third?.id).toBe(c.id);
  });

  it("includes the soft-failing Travy step in the FIFO line like any other", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    const travy = await repo.enqueue({
      jobId: "job-T",
      requestId: "req-T",
      requesterId: "user-T",
      step: RenderStep.TravyGeneration,
    });
    const later = await repo.enqueue({
      jobId: "job-U",
      requestId: "req-U",
      requesterId: "user-U",
      step: RenderStep.AdditionalRatios,
    });
    backdateEnqueue(store, travy.id, 2000);
    backdateEnqueue(store, later.id, 1000);

    const claimed = await repo.claimNext("mac-1", 600);
    expect(claimed?.step).toBe(RenderStep.TravyGeneration);
  });

  it("claims a task exactly once; a concurrent claim gets the next, not the same", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    const one = await repo.enqueue({ jobId: "j1", requestId: "r1", step: RenderStep.MontageMerge });
    const two = await repo.enqueue({ jobId: "j2", requestId: "r2", step: RenderStep.MontageMerge });
    backdateEnqueue(store, one.id, 2000);
    backdateEnqueue(store, two.id, 1000);

    const c1 = await repo.claimNext("mac-1", 600);
    const c2 = await repo.claimNext("mac-2", 600);
    expect(c1?.id).toBe(one.id);
    expect(c2?.id).toBe(two.id);
    expect(c1?.id).not.toBe(c2?.id);

    // Nothing else queued → third claim is null (a fresh claim is not re-grabbed).
    expect(await repo.claimNext("mac-3", 600)).toBeNull();
  });

  it("reclaims a claim whose keep-alive has gone stale (crashed worker)", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    const task = await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.OverlayComposition });

    const first = await repo.claimNext("mac-1", 600);
    expect(first?.claimedBy).toBe("mac-1");
    expect(first?.attempts).toBe(1);

    // Fresh claim is NOT reclaimable.
    expect(await repo.claimNext("mac-2", 600)).toBeNull();

    // Backdate keep-alive beyond the stale window → reclaimable, attempts bumps.
    store.get(task.id)!.heartbeatAt = new Date(Date.now() - 20 * 60_000);
    const second = await repo.claimNext("mac-2", 600);
    expect(second?.id).toBe(task.id);
    expect(second?.claimedBy).toBe("mac-2");
    expect(second?.attempts).toBe(2);
  });

  it("counts how many active tasks are ahead (0 = next up / rendering)", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    const first = await repo.enqueue({ jobId: "j1", requestId: "r1", step: RenderStep.MontageMerge });
    const mid = await repo.enqueue({ jobId: "j2", requestId: "r2", step: RenderStep.OverlayComposition });
    const last = await repo.enqueue({ jobId: "j3", requestId: "r3", step: RenderStep.FfmpegComposition });
    backdateEnqueue(store, first.id, 3000);
    backdateEnqueue(store, mid.id, 2000);
    backdateEnqueue(store, last.id, 1000);

    expect(await repo.countAhead(first.id)).toBe(0);
    expect(await repo.countAhead(mid.id)).toBe(1);
    expect(await repo.countAhead(last.id)).toBe(2);

    // Claiming the head doesn't drop it from the line (it's rendering now), so
    // the others' positions only shrink once it COMPLETES.
    const head = await repo.claimNext("mac-1", 600);
    expect(await repo.countAhead(last.id)).toBe(2);
    await repo.complete(head!.id, "done");
    expect(await repo.countAhead(last.id)).toBe(1);

    // A finished task has no position.
    expect(await repo.countAhead(head!.id)).toBeNull();
  });

  it("re-enqueue replaces a job's active task instead of stacking a second", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.MontageMerge });
    await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.OverlayComposition });

    const active = await repo.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].step).toBe(RenderStep.OverlayComposition);
  });

  it("records duration on completion for the admin monitor", async () => {
    const store = new Map<string, RenderTask>();
    const repo = new MockRenderTaskRepository(store);
    const t = await repo.enqueue({ jobId: "j", requestId: "r", step: RenderStep.MontageMerge });
    const claimed = await repo.claimNext("mac-1", 600);
    // Force a measurable elapsed time.
    store.get(t.id)!.startedAt = new Date(Date.now() - 1500);
    await repo.complete(claimed!.id, "done");
    const done = store.get(t.id)!;
    expect(done.state).toBe("done");
    expect(done.durationMs).toBeGreaterThanOrEqual(1500);
  });
});
