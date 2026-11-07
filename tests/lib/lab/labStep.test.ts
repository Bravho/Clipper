import { handleLabStep, type LabStepDeps } from "@/lib/lab/labStep";

const LAB = "lab.tester@example.com";
const LAB_USER = "lab-1";

function deps(over: Partial<LabStepDeps> = {}): LabStepDeps & { forward: jest.Mock } {
  const forward = jest.fn(async () => ({ status: 200, body: { ok: true } }));
  return {
    flagValue: "true",
    providerExecutionEnabled: true,
    labEmail: LAB,
    requesterRole: "requester",
    getSession: async () => ({ user: { id: LAB_USER, role: "requester", email: LAB } }),
    findRequestOwner: async () => LAB_USER,
    markerExists: async () => true,
    forward,
    ...over,
  } as LabStepDeps & { forward: jest.Mock };
}

const STEP = { requestId: "req-1", action: "approve-voice", payload: { jobId: "j" }, runId: "run-1" };

describe("handleLabStep", () => {
  it("forwards a valid lab step on the lab account's own request", async () => {
    const d = deps();
    const result = await handleLabStep(STEP, d);
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(d.forward).toHaveBeenCalledWith("approve-voice", "req-1", { jobId: "j" });
  });

  it("refuses every action while provider execution is disabled, even for the right account", async () => {
    for (const action of ["start-production", "approve-voice", "scene-design-approve", "approve-overlay"]) {
      const d = deps({ providerExecutionEnabled: false });
      expect(await handleLabStep({ ...STEP, action }, d)).toMatchObject({ status: 404 });
      expect(d.forward).not.toHaveBeenCalled();
    }
  });

  it("does nothing when the flag is off", async () => {
    const d = deps({ flagValue: undefined });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 404 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("stops a step when the flag is switched off after an earlier step was allowed", async () => {
    const first = deps();
    await handleLabStep(STEP, first);
    expect(first.forward).toHaveBeenCalledTimes(1);

    const second = deps({ flagValue: "false" });
    expect(await handleLabStep(STEP, second)).toMatchObject({ status: 404 });
    expect(second.forward).not.toHaveBeenCalled();
  });

  it("refuses a non-lab account, even on its own request", async () => {
    const d = deps({
      getSession: async () => ({ user: { id: "other", role: "requester", email: "pillarth@gmail.com" } }),
      findRequestOwner: async () => "other",
    });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 401 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses a lab email with the wrong role", async () => {
    const d = deps({ getSession: async () => ({ user: { id: LAB_USER, role: "admin", email: LAB } }) });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 401 });
  });

  it("refuses when signed out", async () => {
    const d = deps({ getSession: async () => null });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 401 });
  });

  it("refuses another owner's request without revealing it exists", async () => {
    const d = deps({ findRequestOwner: async () => "someone-else" });
    expect(await handleLabStep(STEP, d)).toEqual({ status: 404, body: { error: "Not found." } });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses a request that does not exist", async () => {
    const d = deps({ findRequestOwner: async () => null });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 404 });
  });

  it("refuses an action that is not on the allow-list", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, action: "delete-request" }, d)).toMatchObject({ status: 400 });
    expect(await handleLabStep({ ...STEP, action: "submit" }, d)).toMatchObject({ status: 400 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses an empty request id", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, requestId: "" }, d)).toMatchObject({ status: 404 });
  });

  it("passes the normal studio route's own refusal back unchanged", async () => {
    const d = deps({ forward: jest.fn(async () => ({ status: 409, body: { error: "locked" } })) });
    expect(await handleLabStep(STEP, d)).toEqual({ status: 409, body: { error: "locked" } });
  });

  it("a chargeable step with no run id is refused, nothing forwarded", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, runId: undefined }, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("a step whose run has no recorded marker is refused, nothing forwarded", async () => {
    const d = deps({ markerExists: async () => false });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("the marker is looked up under the signed-in owner, never a supplied owner", async () => {
    const markerExists = jest.fn(async () => true);
    const d = deps({ markerExists });
    await handleLabStep(STEP, d);
    expect(markerExists).toHaveBeenCalledWith(LAB_USER, "run-1");
  });
});
