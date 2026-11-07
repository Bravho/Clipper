import { handleLabStep, releaseStrandedClaim, type LabStepDeps, type LabRunBinding } from "@/lib/lab/labStep";

const LAB = "lab.tester@example.com";
const LAB_USER = "lab-1";
const OTHER_USER = "lab-2";

function binding(over: Partial<LabRunBinding> = {}): LabRunBinding {
  return { requestId: "req-1", attemptIds: [], uploadAuthorised: [], ...over };
}

function deps(over: Partial<LabStepDeps> = {}): LabStepDeps & { forward: jest.Mock; bindAttempt: jest.Mock; authoriseUpload: jest.Mock; recordUnresolvedClaim: jest.Mock } {
  const forward = jest.fn(async () => ({ status: 200, body: { ok: true } }));
  const bindAttempt = jest.fn(async () => true);
  const authoriseUpload = jest.fn(async () => true);
  return {
    flagValue: "true",
    providerExecutionEnabled: true,
    labEmail: LAB,
    requesterRole: "requester",
    getSession: async () => ({ user: { id: LAB_USER, role: "requester", email: LAB } }),
    findRequestOwner: async () => LAB_USER,
    markerExists: async () => true,
    getBinding: async () => binding(),
    bindAttempt,
    authoriseUpload,
    recordUnresolvedClaim: jest.fn(async () => true),
    forward,
    ...over,
  } as LabStepDeps & { forward: jest.Mock; bindAttempt: jest.Mock; authoriseUpload: jest.Mock; recordUnresolvedClaim: jest.Mock };
}

const STEP = { requestId: "req-1", action: "approve-voice", payload: { jobId: "j" }, runId: "run-1" };
const ATTEMPT_STEP = { requestId: "req-1", action: "device-complete", payload: {}, runId: "run-1", attemptId: "att-1" };

describe("handleLabStep: the normal path", () => {
  it("forwards a valid step on the lab account's own request, with the request id", async () => {
    const d = deps();
    const result = await handleLabStep(STEP, d);
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(d.forward).toHaveBeenCalledWith("approve-voice", { requestId: "req-1", attemptId: undefined }, { jobId: "j" });
  });

  it("does nothing when the flag is off (new work)", async () => {
    const d = deps({ flagValue: undefined });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 404 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses every new-work action while provider execution is disabled, even for the right account", async () => {
    for (const action of ["submit", "start-production", "approve-voice", "scene-design-approve", "approve-overlay", "device-claim"]) {
      const d = deps({ providerExecutionEnabled: false });
      expect(await handleLabStep({ ...STEP, action, payload: { requestId: "req-1" } }, d)).toMatchObject({ status: 404 });
      expect(d.forward).not.toHaveBeenCalled();
    }
  });

  it("a step after the flag was switched off is refused (the server checks each call)", async () => {
    const first = deps();
    await handleLabStep(STEP, first);
    expect(first.forward).toHaveBeenCalledTimes(1);
    const second = deps({ flagValue: "false" });
    expect(await handleLabStep(STEP, second)).toMatchObject({ status: 404 });
    expect(second.forward).not.toHaveBeenCalled();
  });
});

describe("handleLabStep: identity and ownership", () => {
  it("refuses a non-lab account, even on its own request", async () => {
    const d = deps({
      getSession: async () => ({ user: { id: OTHER_USER, role: "requester", email: "pillarth@gmail.com" } }),
      findRequestOwner: async () => OTHER_USER,
    });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 401 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses the lab email with the wrong role, and a signed-out caller", async () => {
    expect(await handleLabStep(STEP, deps({ getSession: async () => ({ user: { id: LAB_USER, role: "admin", email: LAB } }) }))).toMatchObject({ status: 401 });
    expect(await handleLabStep(STEP, deps({ getSession: async () => null }))).toMatchObject({ status: 401 });
  });

  it("refuses another owner's request without revealing it exists", async () => {
    const d = deps({ findRequestOwner: async () => "someone-else" });
    expect(await handleLabStep(STEP, d)).toEqual({ status: 404, body: { error: "Not found." } });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("the marker and the binding are looked up under the signed-in owner, never a supplied owner", async () => {
    const markerExists = jest.fn(async () => true);
    const getBinding = jest.fn(async () => binding());
    await handleLabStep(STEP, deps({ markerExists, getBinding }));
    expect(markerExists).toHaveBeenCalledWith(LAB_USER, "run-1");
    expect(getBinding).toHaveBeenCalledWith(LAB_USER, "run-1");
  });
});

describe("handleLabStep: explicit allow-list and plain ids", () => {
  it("refuses an action that is not on the allow-list (no URL is ever forwarded)", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, action: "delete-request" }, d)).toMatchObject({ status: 400 });
    expect(await handleLabStep({ ...STEP, action: "/api/admin/users" }, d)).toMatchObject({ status: 400 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("refuses an unsafe request id or attempt id", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, requestId: "../x" }, d)).toMatchObject({ status: 400 });
    expect(await handleLabStep({ ...ATTEMPT_STEP, attemptId: "a/../b" }, d)).toMatchObject({ status: 400 });
    expect(d.forward).not.toHaveBeenCalled();
  });
});

describe("handleLabStep: the run must be recorded and linked to this request and attempt", () => {
  it("a step with no run id is refused", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, runId: undefined }, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("a run with no recorded marker is refused", async () => {
    const d = deps({ markerExists: async () => false });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("a marker for run A does not authorise request B: the run is linked to another request", async () => {
    const d = deps({ getBinding: async () => binding({ requestId: "req-A" }) });
    expect(await handleLabStep({ ...STEP, requestId: "req-B" }, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("a run with no link at all (no draft created) is refused", async () => {
    const d = deps({ getBinding: async () => null });
    expect(await handleLabStep(STEP, d)).toMatchObject({ status: 409 });
  });

  it("an attempt that is not linked to this run is refused", async () => {
    const d = deps({ getBinding: async () => binding({ attemptIds: ["other-attempt"] }) });
    expect(await handleLabStep(ATTEMPT_STEP, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("an attempt linked to run A cannot be used with run B", async () => {
    const getBinding = jest.fn(async (_o: string, runId: string) => (runId === "run-A" ? binding({ attemptIds: ["att-1"] }) : binding()));
    const d = deps({ getBinding });
    expect(await handleLabStep({ ...ATTEMPT_STEP, runId: "run-B" }, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("a claim must be for this request", async () => {
    const d = deps();
    expect(await handleLabStep({ ...STEP, action: "device-claim", payload: { requestId: "req-B" } }, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });
});

describe("handleLabStep: links the server creates", () => {
  it("a successful claim links the returned attempt to this run before the caller gets it", async () => {
    const d = deps({ forward: jest.fn(async () => ({ status: 200, body: { claimed: true, attemptId: "att-new" } })) });
    const result = await handleLabStep({ requestId: "req-1", action: "device-claim", payload: { requestId: "req-1" }, runId: "run-1" }, d);
    expect(result).toEqual({ status: 200, body: { claimed: true, attemptId: "att-new" } });
    expect(d.bindAttempt).toHaveBeenCalledWith(LAB_USER, "run-1", "req-1", "att-new");
  });

  it("a claim with no attempt in the answer is refused as bad gateway", async () => {
    const d = deps({ forward: jest.fn(async () => ({ status: 200, body: { claimed: false, reason: "no_render_queued" } })) });
    expect(await handleLabStep({ requestId: "req-1", action: "device-claim", payload: { requestId: "req-1" }, runId: "run-1" }, d)).toMatchObject({ status: 502 });
    expect(d.bindAttempt).not.toHaveBeenCalled();
  });

  it("if the attempt cannot be linked, the caller is not given it", async () => {
    const d = deps({
      forward: jest.fn(async () => ({ status: 200, body: { claimed: true, attemptId: "att-new" } })),
      bindAttempt: jest.fn(async () => false),
    });
    const result = await handleLabStep({ requestId: "req-1", action: "device-claim", payload: { requestId: "req-1" }, runId: "run-1" }, d);
    expect(result).toMatchObject({ status: 409 });
    expect((result.body as { attemptId?: string }).attemptId).toBeUndefined();
  });

  it("a successful upload authorisation is recorded for the attempt", async () => {
    const d = deps({ getBinding: async () => binding({ attemptIds: ["att-1"] }) });
    await handleLabStep({ ...ATTEMPT_STEP, action: "device-upload-authorize", payload: { action: "authorize" } }, d);
    expect(d.authoriseUpload).toHaveBeenCalledWith(LAB_USER, "run-1", "att-1");
  });
});

describe("handleLabStep: stop rules", () => {
  it("stopped: new work is refused (flag off)", async () => {
    const d = deps({ flagValue: "false" });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-upload-authorize", payload: {} }, d)).toMatchObject({ status: 404 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("stopped: release is still allowed for a linked attempt (safe termination)", async () => {
    const d = deps({ flagValue: "false", providerExecutionEnabled: false, getBinding: async () => binding({ attemptIds: ["att-1"] }) });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-release", payload: { reason: "stopped" } }, d)).toEqual({ status: 200, body: { ok: true } });
    expect(d.forward).toHaveBeenCalledTimes(1);
  });

  it("stopped: release for an attempt not linked to this run is refused", async () => {
    const d = deps({ flagValue: "false", providerExecutionEnabled: false, getBinding: async () => binding({ attemptIds: [] }) });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-release", payload: {} }, d)).toMatchObject({ status: 409 });
    expect(d.forward).not.toHaveBeenCalled();
  });

  it("stopped: progress is allowed for a linked attempt", async () => {
    const d = deps({ flagValue: "false", providerExecutionEnabled: false, getBinding: async () => binding({ attemptIds: ["att-1"] }) });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-progress", payload: { percent: 10 } }, d)).toEqual({ status: 200, body: { ok: true } });
  });

  it("stopped: complete is refused unless its upload was authorised before the stop", async () => {
    const notAuthorised = deps({ flagValue: "false", providerExecutionEnabled: false, getBinding: async () => binding({ attemptIds: ["att-1"] }) });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-complete" }, notAuthorised)).toMatchObject({ status: 409 });
    expect(notAuthorised.forward).not.toHaveBeenCalled();

    const authorised = deps({ flagValue: "false", providerExecutionEnabled: false, getBinding: async () => binding({ attemptIds: ["att-1"], uploadAuthorised: ["att-1"] }) });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-complete" }, authorised)).toEqual({ status: 200, body: { ok: true } });
  });

  it("running: finish needs an authorised upload too", async () => {
    const d = deps({ getBinding: async () => binding({ attemptIds: ["att-1"] }) });
    expect(await handleLabStep({ ...ATTEMPT_STEP, action: "device-upload-finish", payload: { action: "finish" } }, d)).toMatchObject({ status: 409 });
  });
});

describe("a claim that cannot be linked is released on the server, never handed out", () => {
  const claimStep = { requestId: "req-1", action: "device-claim", payload: { requestId: "req-1" }, runId: "run-1" };
  const claimed = { status: 200, body: { claimed: true, attemptId: "att-new" } };

  it("link fails and the release succeeds: the attempt id is withheld, the release is internal, nothing is recorded as stranded", async () => {
    const forward = jest.fn(async (action: string) => (action === "device-claim" ? claimed : { status: 200, body: { released: true } }));
    const d = deps({ forward, bindAttempt: jest.fn(async () => false) });
    const result = await handleLabStep(claimStep, d);
    expect(result).toMatchObject({ status: 409 });
    expect((result.body as { attemptId?: string }).attemptId).toBeUndefined();
    expect(forward).toHaveBeenCalledWith("device-release", { requestId: "req-1", attemptId: "att-new" }, expect.anything());
    expect(d.recordUnresolvedClaim).not.toHaveBeenCalled();
  });

  it("link fails and the release answers an error: the claim is recorded as unresolved for a person", async () => {
    const forward = jest.fn(async (action: string) => (action === "device-claim" ? claimed : { status: 500, body: {} }));
    const d = deps({ forward, bindAttempt: jest.fn(async () => false) });
    await handleLabStep(claimStep, d);
    expect(d.recordUnresolvedClaim).toHaveBeenCalledWith(LAB_USER, "run-1", "att-new");
  });

  it("link fails and the release throws: the claim is recorded as unresolved", async () => {
    const forward = jest.fn(async (action: string) => {
      if (action === "device-claim") return claimed;
      throw new Error("network down");
    });
    const d = deps({ forward, bindAttempt: jest.fn(async () => false) });
    expect(await handleLabStep(claimStep, d)).toMatchObject({ status: 409 });
    expect(d.recordUnresolvedClaim).toHaveBeenCalledWith(LAB_USER, "run-1", "att-new");
  });

  it("the release never waits longer than its bound: a hung release is treated as failed", async () => {
    const hung = () => new Promise<never>(() => undefined);
    expect(await releaseStrandedClaim({ forward: hung as never }, { requestId: "r", attemptId: "a" }, 20)).toBe(false);
  });
});
