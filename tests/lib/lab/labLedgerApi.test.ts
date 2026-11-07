import { handleLedgerApi, createRemoteLedger } from "@/lib/lab/labLedgerApi";

const LAB = "lab.tester@example.com";
const identity = {
  flagValue: "true",
  labEmail: LAB,
  requesterRole: "requester",
  session: { user: { id: "lab-1", role: "requester", email: LAB } },
};

function fakeLedger() {
  return {
    reserve: jest.fn(async () => ({ ok: true as const })),
    markSpendAttempt: jest.fn(async () => true),
    hasSpendAttempt: jest.fn(async () => false),
    settle: jest.fn(async () => true),
    release: jest.fn(async () => true),
    usedToday: jest.fn(async () => 0),
  };
}

const base = (over: Record<string, unknown> = {}) => ({
  flagValue: "true",
  providerExecutionEnabled: true,
  identity,
  ledger: fakeLedger(),
  ...over,
});

describe("handleLedgerApi guards (the ledger is never touched when a guard fails)", () => {
  it("flag off: 404, nothing touched", async () => {
    const d = base({ flagValue: undefined });
    expect(await handleLedgerApi({ op: "usedToday" }, d)).toMatchObject({ status: 404 });
    expect(d.ledger.usedToday).not.toHaveBeenCalled();
  });

  it("provider execution disabled: 404, nothing touched", async () => {
    const d = base({ providerExecutionEnabled: false });
    expect(await handleLedgerApi({ op: "reserve", runId: "r", credits: 10 }, d)).toMatchObject({ status: 404 });
    expect(d.ledger.reserve).not.toHaveBeenCalled();
  });

  it("another account: 401, nothing touched", async () => {
    const d = base({ identity: { ...identity, session: { user: { id: "x", role: "requester", email: "other@x.com" } } } });
    expect(await handleLedgerApi({ op: "usedToday" }, d)).toMatchObject({ status: 401 });
    expect(d.ledger.usedToday).not.toHaveBeenCalled();
  });

  it("a bad body: 400, nothing touched", async () => {
    const d = base();
    expect(await handleLedgerApi({ op: "reserve", runId: "r" }, d)).toMatchObject({ status: 400 });
    expect(await handleLedgerApi({ op: "nope" }, d)).toMatchObject({ status: 400 });
    expect(await handleLedgerApi(null, d)).toMatchObject({ status: 400 });
    expect(d.ledger.reserve).not.toHaveBeenCalled();
  });
});

describe("handleLedgerApi maps each operation to the ledger", () => {
  it("reserve, mark, has-marker, settle, release, usedToday", async () => {
    const d = base();
    expect(await handleLedgerApi({ op: "reserve", runId: "r", credits: 341 }, d)).toEqual({ status: 200, body: { ok: true } });
    expect(d.ledger.reserve).toHaveBeenCalledWith("r", 341);
    expect(await handleLedgerApi({ op: "markSpendAttempt", runId: "r" }, d)).toEqual({ status: 200, body: { ok: true } });
    expect(await handleLedgerApi({ op: "hasSpendAttempt", runId: "r" }, d)).toEqual({ status: 200, body: { value: false } });
    expect(await handleLedgerApi({ op: "settle", runId: "r" }, d)).toEqual({ status: 200, body: { ok: true } });
    expect(await handleLedgerApi({ op: "release", runId: "r" }, d)).toEqual({ status: 200, body: { ok: true } });
    expect(await handleLedgerApi({ op: "usedToday" }, d)).toEqual({ status: 200, body: { value: 0 } });
  });
});

describe("createRemoteLedger (phone side) fails closed", () => {
  it("a failed server call is refused reserve, no marker, unknown history, nothing settled or released", async () => {
    const remote = createRemoteLedger(async () => {
      throw new Error("offline");
    });
    expect(await remote.reserve("r", 10)).toEqual({ ok: false, reason: "ledger_unreadable" });
    expect(await remote.markSpendAttempt("r")).toBe(false);
    expect(await remote.hasSpendAttempt("r")).toBeNull();
    expect(await remote.settle("r")).toBe(false);
    expect(await remote.release("r")).toBe(false);
    expect(await remote.usedToday()).toBeNull();
  });

  it("a 404 from the server is treated the same way (fail closed)", async () => {
    const remote = createRemoteLedger(async () => ({ status: 404, body: {} }));
    expect(await remote.reserve("r", 10)).toEqual({ ok: false, reason: "ledger_unreadable" });
    expect(await remote.hasSpendAttempt("r")).toBeNull();
  });

  it("maps a successful server answer through", async () => {
    const remote = createRemoteLedger(async (req) => {
      if (req.op === "reserve") return { status: 200, body: { ok: true } };
      if (req.op === "hasSpendAttempt") return { status: 200, body: { value: true } };
      return { status: 200, body: { ok: true, value: 0 } };
    });
    expect(await remote.reserve("r", 10)).toEqual({ ok: true });
    expect(await remote.hasSpendAttempt("r")).toBe(true);
  });
});

// ── phone client -> server handler -> the real file ledger (temp folder) ─────
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LabSpendLedger, createFileLedgerStorage, createFileLock } from "@/lib/lab/labSpendLedger";

describe("end to end: phone client -> server handler -> file ledger", () => {
  it("the marker and the reservation are on the server side, and a second phone sees them", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lab-api-"));
    try {
      const ledger = new LabSpendLedger(
        createFileLedgerStorage(path.join(dir, "ledger.json")),
        () => new Date("2026-11-07T03:00:00Z"),
        "Asia/Bangkok",
        createFileLock(path.join(dir, "ledger.lock"), { timeoutMs: 2000, retryMs: 5 })
      );
      const post = (body: unknown) =>
        handleLedgerApi(body, { flagValue: "true", providerExecutionEnabled: true, identity, ledger });
      const phone = createRemoteLedger(post);
      expect(await phone.reserve("run-1", 341)).toEqual({ ok: true });
      expect(await phone.markSpendAttempt("run-1")).toBe(true);
      // A second phone (another client on the same server ledger) sees the marker.
      const otherPhone = createRemoteLedger(post);
      expect(await otherPhone.hasSpendAttempt("run-1")).toBe(true);
      // The marker blocks release.
      expect(await phone.release("run-1")).toBe(false);
      expect(await phone.usedToday()).toBe(341);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
