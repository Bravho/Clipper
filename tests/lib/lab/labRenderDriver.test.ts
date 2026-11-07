import { driveLabRender, type LabRenderDriverDeps, type RenderOutcomeLike } from "@/lib/lab/labRenderDriver";
import { LabRunGuard } from "@/lib/lab/labSteps";

const done: RenderOutcomeLike = { status: "refused", reason: "no_render_queued" };
const ok = (id: string): RenderOutcomeLike => ({ status: "completed", assetId: id });

function deps(steps: RenderOutcomeLike[], over: Partial<LabRenderDriverDeps> = {}) {
  let i = 0;
  const runOnce = jest.fn(async () => steps[Math.min(i++, steps.length - 1)]);
  return {
    d: { flagOn: () => true, runOnce, ...over } as LabRenderDriverDeps & { runOnce: jest.Mock },
    runOnce,
  };
}

const NEVER = () => false;

describe("driveLabRender: happy path", () => {
  it("counts each step with a server asset id and stops when nothing is queued", async () => {
    const { d, runOnce } = deps([ok("a1"), ok("a2"), done]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 10, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "done", durableAssetIds: ["a1", "a2"] });
    expect(runOnce).toHaveBeenCalledTimes(3);
  });
});

describe("driveLabRender: durability", () => {
  it("does not count a completed step without an asset id, and stops", async () => {
    const { d } = deps([ok("a1"), { status: "completed", assetId: null }, ok("a3")]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 10, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "failed", step: 2, reason: "completed_without_asset", durableAssetIds: ["a1"] });
  });

  it("counts an empty asset id as not durable", async () => {
    const { d } = deps([{ status: "completed", assetId: "" }]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: NEVER }, d);
    expect(result).toMatchObject({ status: "failed", durableAssetIds: [] });
  });

  it("fails on a failed PUT, finish or complete (reported as failed) and keeps what was durable", async () => {
    const { d } = deps([ok("a1"), { status: "failed", reason: "put_failed" }]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "failed", step: 2, reason: "put_failed", durableAssetIds: ["a1"] });
  });

  it("treats a wrong-attempt or superseded response as failed, with nothing durable", async () => {
    const { d } = deps([{ status: "released", reason: "attempt_superseded" }]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "failed", step: 1, reason: "attempt_superseded", durableAssetIds: [] });
  });

  it("treats any other refusal as failed, not as done", async () => {
    const { d } = deps([{ status: "refused", reason: "insufficient_storage" }]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: NEVER }, d);
    expect(result).toMatchObject({ status: "failed", reason: "insufficient_storage" });
  });
});

describe("driveLabRender: cancellation and flag", () => {
  it("does not start a step when already cancelled", async () => {
    const { d, runOnce } = deps([ok("a1")]);
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: () => true }, d);
    expect(result).toEqual({ status: "cancelled", durableAssetIds: [] });
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("stops before the next step when cancelled after a durable step", async () => {
    let cancelled = false;
    const { d, runOnce } = deps([ok("a1"), ok("a2")]);
    runOnce.mockImplementationOnce(async () => {
      cancelled = true;
      return ok("a1");
    });
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: () => cancelled }, d);
    expect(result).toEqual({ status: "cancelled", durableAssetIds: ["a1"] });
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("reports cancellation, not failure, when a step stops because the user cancelled", async () => {
    let cancelled = false;
    const { d } = deps([]);
    d.runOnce.mockImplementationOnce(async () => {
      cancelled = true;
      return { status: "released", reason: "cancelled" };
    });
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: () => cancelled }, d);
    expect(result).toEqual({ status: "cancelled", durableAssetIds: [] });
  });

  it("stops with flag_off when the flag is switched off mid-run", async () => {
    let flag = true;
    const { d, runOnce } = deps([ok("a1"), ok("a2")], { flagOn: () => flag });
    runOnce.mockImplementationOnce(async () => {
      flag = false;
      return ok("a1");
    });
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "flag_off", durableAssetIds: ["a1"] });
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("does not start any step when the flag is already off", async () => {
    const { d, runOnce } = deps([ok("a1")], { flagOn: () => false });
    const result = await driveLabRender({ requestId: "r", maxSteps: 5, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "flag_off", durableAssetIds: [] });
    expect(runOnce).not.toHaveBeenCalled();
  });
});

describe("driveLabRender: bounds and duplicates", () => {
  it("stops at maxSteps even if more work is always queued", async () => {
    let n = 0;
    const { d } = deps([], { runOnce: jest.fn(async () => ok(`a${++n}`)) } as never);
    const result = await driveLabRender({ requestId: "r", maxSteps: 3, cancelled: NEVER }, d);
    expect(result).toEqual({ status: "bounded_exhausted", durableAssetIds: ["a1", "a2", "a3"] });
    expect(d.runOnce).toHaveBeenCalledTimes(3);
  });

  it("a second trigger for the same request is refused while the first run is active", async () => {
    const guard = new LabRunGuard();
    expect(guard.acquire("lab-1:req-1")).toBe(true);
    // The orchestrator must not call the driver when the guard refuses.
    expect(guard.acquire("lab-1:req-1")).toBe(false);
    guard.release("lab-1:req-1");
    expect(guard.acquire("lab-1:req-1")).toBe(true);
  });
});
