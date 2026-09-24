import { MockRenderTaskRepository } from "@/repositories/mock/MockRenderTaskRepository";
import { RenderStep } from "@/domain/enums/RenderStep";

/** The step set a phone is allowed to take; mirrors DEVICE_RENDER.eligibleSteps. */
const ALLOWED = [RenderStep.OverlayComposition];

describe("device render claims", () => {
  function setup() {
    return new MockRenderTaskRepository(new Map());
  }

  it("only the request owner can claim a queued overlay", async () => {
    const repo = setup();
    const task = await repo.enqueue({ jobId: "job", requestId: "request", requesterId: "owner", step: RenderStep.OverlayComposition });
    expect(await repo.claimForDevice(task.id, "other", "device:other:1", ALLOWED)).toBeNull();
    expect(await repo.claimForDevice(task.id, "owner", "device:owner:1", ALLOWED)).toMatchObject({ state: "claimed" });
    expect(await repo.claimForDevice(task.id, "owner", "device:owner:2", ALLOWED)).toBeNull();
  });

  it("an old device cannot complete or release a worker-reclaimed task", async () => {
    const repo = setup();
    const task = await repo.enqueue({ jobId: "job", requestId: "request", requesterId: "owner", step: RenderStep.OverlayComposition });
    await repo.claimForDevice(task.id, "owner", "device:owner:1", ALLOWED);
    expect(await repo.releaseClaim(task.id, "device:owner:1")).toBe(true);
    expect(await repo.claimNext("worker", 120)).toMatchObject({ claimedBy: "worker" });
    expect(await repo.completeClaim(task.id, "device:owner:1")).toBe(false);
    expect(await repo.releaseClaim(task.id, "device:owner:1")).toBe(false);
    expect((await repo.findActiveByJob("job"))?.claimedBy).toBe("worker");
  });

  it("rejects device completion after the worker reclaims an expired heartbeat", async () => {
    const store = new Map();
    const repo = new MockRenderTaskRepository(store);
    const task = await repo.enqueue({ jobId: "job", requestId: "request", requesterId: "owner", step: RenderStep.OverlayComposition });
    await repo.claimForDevice(task.id, "owner", "device:owner:1", ALLOWED);
    const claimed = store.get(task.id)!;
    store.set(task.id, { ...claimed, heartbeatAt: new Date(Date.now() - 121_000) });

    expect(await repo.claimNext("worker", 120)).toMatchObject({ claimedBy: "worker" });
    expect(await repo.touchClaim(task.id, "device:owner:1")).toBe(false);
    expect(await repo.completeClaim(task.id, "device:owner:1")).toBe(false);
  });
});
