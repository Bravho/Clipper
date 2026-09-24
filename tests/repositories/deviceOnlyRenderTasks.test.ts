import { MockRenderTaskRepository } from "@/repositories/mock/MockRenderTaskRepository";
import { RenderStep } from "@/domain/enums/RenderStep";

/**
 * The queue rule that keeps two rendering paths from colliding.
 *
 * A request whose originals stayed on the requester's phone has no footage on
 * the droplet and none on the Mac Mini. If the worker could claim one of its
 * steps, the only possible outcome is a failed render and a refunded allowance
 * — so the exclusion lives in the CLAIM, where it makes the mistake impossible
 * rather than merely handled.
 *
 * The other half matters just as much: every task that is NOT device-only must
 * behave exactly as it did before this column existed, because that is the path
 * every installed app and every existing request still takes.
 */

/** The steps a phone may opportunistically take off the worker. */
const ALLOWED = [RenderStep.OverlayComposition];

describe("device-only render tasks", () => {
  function setup() {
    return new MockRenderTaskRepository(new Map());
  }

  it("defaults to worker-claimable, so nothing that exists today changes", async () => {
    const repo = setup();
    const task = await repo.enqueue({
      jobId: "job",
      requestId: "request",
      requesterId: "owner",
      step: RenderStep.FfmpegComposition,
    });

    expect(task.deviceOnly).toBe(false);
    expect(await repo.claimNext("mac-worker", 120)).toMatchObject({ claimedBy: "mac-worker" });
  });

  it("hides a device-only task from the worker entirely", async () => {
    const repo = setup();
    await repo.enqueue({
      jobId: "job",
      requestId: "request",
      requesterId: "owner",
      step: RenderStep.MontageMerge,
      deviceOnly: true,
    });

    // Not "claims and fails" — never claimed at all. The worker has no copy of
    // the footage, so there is nothing it could usefully do with this row.
    expect(await repo.claimNext("mac-worker", 120)).toBeNull();
  });

  it("does not let a device-only task block the worker's other work", async () => {
    const repo = setup();
    await repo.enqueue({
      jobId: "device-job",
      requestId: "device-request",
      requesterId: "owner",
      step: RenderStep.MontageMerge,
      deviceOnly: true,
    });
    await repo.enqueue({
      jobId: "server-job",
      requestId: "server-request",
      requesterId: "other",
      step: RenderStep.FfmpegComposition,
    });

    const claimed = await repo.claimNext("mac-worker", 120);
    expect(claimed?.jobId).toBe("server-job");
  });

  it("lets the owning device claim a device-only step outside the allowlist", async () => {
    // The allowlist limits what a phone may take from the worker opportunistically.
    // A device-only task is not opportunistic — its footage is on that phone and
    // nowhere else, so the list does not apply.
    const repo = setup();
    const task = await repo.enqueue({
      jobId: "job",
      requestId: "request",
      requesterId: "owner",
      step: RenderStep.MontageMerge,
      deviceOnly: true,
    });

    expect(await repo.claimForDevice(task.id, "owner", "device:1", ALLOWED)).toMatchObject({
      state: "claimed",
      claimedBy: "device:1",
    });
  });

  it("still refuses a device-only task to the wrong requester", async () => {
    const repo = setup();
    const task = await repo.enqueue({
      jobId: "job",
      requestId: "request",
      requesterId: "owner",
      step: RenderStep.MontageMerge,
      deviceOnly: true,
    });

    expect(await repo.claimForDevice(task.id, "someone-else", "device:2", ALLOWED)).toBeNull();
  });

  it("keeps the allowlist in force for ordinary server-path work", async () => {
    // A phone must not quietly take a montage off the Mac Mini just because it
    // asked: that work has uploaded footage and belongs to the worker until the
    // step is admitted by config.
    const repo = setup();
    const task = await repo.enqueue({
      jobId: "job",
      requestId: "request",
      requesterId: "owner",
      step: RenderStep.MontageMerge,
    });

    expect(await repo.claimForDevice(task.id, "owner", "device:1", ALLOWED)).toBeNull();
  });

  it("never reclaims a device-only task for the worker when its lease goes stale", async () => {
    // The stale-claim path is the worker's safety net for a crashed worker. It
    // must not become a back door that hands device-held work to a machine with
    // no media, however long the phone has been silent.
    const store = new Map();
    const repo = new MockRenderTaskRepository(store);
    const task = await repo.enqueue({
      jobId: "job",
      requestId: "request",
      requesterId: "owner",
      step: RenderStep.MontageMerge,
      deviceOnly: true,
    });
    await repo.claimForDevice(task.id, "owner", "device:1", ALLOWED);

    const claimed = store.get(task.id)!;
    store.set(task.id, { ...claimed, heartbeatAt: new Date(Date.now() - 600_000) });

    expect(await repo.claimNext("mac-worker", 120)).toBeNull();

    // The requester's own phone can still pick it back up after releasing it.
    await repo.releaseClaim(task.id, "device:1");
    expect(await repo.claimForDevice(task.id, "owner", "device:2", ALLOWED)).toMatchObject({
      claimedBy: "device:2",
    });
  });
});
