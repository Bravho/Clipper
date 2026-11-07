import {
  LabRunGuard,
  decideLabIdentity,
  uploadIsDurable,
  waitBounded,
  type LabIdentityInput,
} from "@/lib/lab/labSteps";

const LAB = "lab.tester@example.com";

function base(over: Partial<LabIdentityInput> = {}): LabIdentityInput {
  return {
    flagValue: "true",
    labEmail: LAB,
    requesterRole: "requester",
    session: { user: { id: "lab-1", role: "requester", email: LAB } },
    ...over,
  };
}

describe("decideLabIdentity (draft creation, no request yet)", () => {
  it("returns the session owner id for the lab account", () => {
    expect(decideLabIdentity(base())).toEqual({ ok: true, userId: "lab-1" });
  });
  it("is 404 when the flag is off, whatever the session", () => {
    expect(decideLabIdentity(base({ flagValue: "false" }))).toMatchObject({ ok: false, status: 404, reason: "flag_off" });
  });
  it("is 401 for another account, a wrong role, no session, no id", () => {
    expect(decideLabIdentity(base({ session: { user: { id: "x", role: "requester", email: "other@x.com" } } }))).toMatchObject({ ok: false, status: 401 });
    expect(decideLabIdentity(base({ session: { user: { id: "lab-1", role: "admin", email: LAB } } }))).toMatchObject({ ok: false, status: 401 });
    expect(decideLabIdentity(base({ session: null }))).toMatchObject({ ok: false, status: 401 });
    expect(decideLabIdentity(base({ session: { user: { id: "", role: "requester", email: LAB } } }))).toMatchObject({ ok: false, status: 401 });
  });
});

describe("uploadIsDurable", () => {
  const good = { finishOk: true };
  const complete = { ok: true, assetId: "asset-1" };

  it("counts only when the upload was assembled AND the server returned an asset", () => {
    expect(uploadIsDurable(good, complete)).toBe(true);
  });
  it("does not count a render alone (no finish, no complete)", () => {
    expect(uploadIsDurable(null, null)).toBe(false);
  });
  it("does not count when the multipart assembly failed", () => {
    expect(uploadIsDurable({ finishOk: false }, complete)).toBe(false);
  });
  it("does not count when the server did not verify the object", () => {
    expect(uploadIsDurable(good, { ok: false, assetId: null })).toBe(false);
    expect(uploadIsDurable(good, { ok: true, assetId: null })).toBe(false);
    expect(uploadIsDurable(good, { ok: true, assetId: "" })).toBe(false);
  });
});

describe("waitBounded", () => {
  const instant = async () => undefined;

  it("returns the first ready value and stops polling", async () => {
    let calls = 0;
    const result = await waitBounded(async () => (++calls === 3 ? "ready" : null), {
      maxAttempts: 10,
      intervalMs: 1,
      sleep: instant,
    });
    expect(result).toEqual({ status: "ready", value: "ready", attempts: 3 });
    expect(calls).toBe(3);
  });

  it("times out after maxAttempts and never polls more", async () => {
    let calls = 0;
    const result = await waitBounded(async () => {
      calls++;
      return null;
    }, { maxAttempts: 4, intervalMs: 1, sleep: instant });
    expect(result).toEqual({ status: "timeout", attempts: 4 });
    expect(calls).toBe(4);
  });

  it("stops at once when cancelled", async () => {
    let calls = 0;
    let cancelled = false;
    const result = await waitBounded(async () => {
      calls++;
      cancelled = true;
      return null;
    }, { maxAttempts: 10, intervalMs: 1, sleep: instant, isCancelled: () => cancelled });
    expect(result.status).toBe("cancelled");
    expect(calls).toBe(1);
  });

  it("does not sleep after the last attempt", async () => {
    const sleep = jest.fn(instant);
    await waitBounded(async () => null, { maxAttempts: 3, intervalMs: 5, sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("LabRunGuard (duplicate triggers)", () => {
  it("allows one run per key and refuses a second while it is active", () => {
    const guard = new LabRunGuard();
    expect(guard.acquire("lab")).toBe(true);
    expect(guard.acquire("lab")).toBe(false);
    expect(guard.isActive("lab")).toBe(true);
  });
  it("allows a new run after release", () => {
    const guard = new LabRunGuard();
    guard.acquire("lab");
    guard.release("lab");
    expect(guard.acquire("lab")).toBe(true);
  });
  it("keeps different keys independent", () => {
    const guard = new LabRunGuard();
    expect(guard.acquire("a")).toBe(true);
    expect(guard.acquire("b")).toBe(true);
  });
});
