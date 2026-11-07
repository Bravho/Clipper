import {
  LabSpendLedger,
  dayKeyFor,
  LAB_LEDGER_PER_DAY_CAP,
  LAB_LEDGER_PER_RUN_CAP,
  type LabLedgerState,
  type LabLedgerStorage,
} from "@/lib/lab/labSpendLedger";

/** Fake storage: keeps a JSON copy, like a file would. */
function fakeStorage(initial?: unknown): LabLedgerStorage & { raw: string | null; failRead?: boolean; failWrite?: boolean } {
  const store = {
    raw: initial === undefined ? null : JSON.stringify(initial),
    failRead: false,
    failWrite: false,
    async read() {
      if (store.failRead) throw new Error("disk gone");
      return store.raw === null ? null : JSON.parse(store.raw);
    },
    async write(state: LabLedgerState) {
      if (store.failWrite) throw new Error("disk full");
      store.raw = JSON.stringify(state);
    },
  };
  return store;
}

// 2026-11-07 10:00 in Bangkok (03:00 UTC)
const MORNING = new Date("2026-11-07T03:00:00Z");
const NEXT_DAY = new Date("2026-11-08T03:00:00Z");

describe("dayKeyFor", () => {
  it("uses the Bangkok calendar day, not UTC", () => {
    // 2026-11-06 20:00 UTC is 2026-11-07 03:00 in Bangkok
    expect(dayKeyFor(new Date("2026-11-06T20:00:00Z"))).toBe("2026-11-07");
    // 2026-11-06 16:00 UTC is 2026-11-06 23:00 in Bangkok
    expect(dayKeyFor(new Date("2026-11-06T16:00:00Z"))).toBe("2026-11-06");
  });
});

describe("per-run cap", () => {
  it("allows exactly 350", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    expect(await ledger.reserve("r1", LAB_LEDGER_PER_RUN_CAP)).toEqual({ ok: true });
  });
  it("refuses 351", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    expect(await ledger.reserve("r1", LAB_LEDGER_PER_RUN_CAP + 1)).toEqual({ ok: false, reason: "run_over_cap" });
  });
  it("refuses zero, negative and non-numbers", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    for (const credits of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await ledger.reserve("r", credits)).toEqual({ ok: false, reason: "bad_amount" });
    }
  });
});

describe("per-day cap", () => {
  it("allows runs up to exactly 1000 in one day, then refuses", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    expect(await ledger.reserve("a", 350)).toEqual({ ok: true });
    expect(await ledger.reserve("b", 350)).toEqual({ ok: true });
    expect(await ledger.reserve("c", 300)).toEqual({ ok: true }); // 1000 exactly
    expect(await ledger.reserve("d", 1)).toEqual({ ok: false, reason: "day_over_cap" });
  });

  it("counts reservations that are not settled yet", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    await ledger.reserve("a", 350);
    await ledger.reserve("b", 350);
    // 350 + 350 reserved, and 350 more would be 1050: over the 1000 day cap.
    expect(await ledger.reserve("c", 350)).toEqual({ ok: false, reason: "day_over_cap" });
  });
});

describe("settle and release", () => {
  it("settle keeps the credits used today", async () => {
    const storage = fakeStorage();
    const ledger = new LabSpendLedger(storage, () => MORNING);
    await ledger.reserve("a", 350);
    expect(await ledger.settle("a")).toBe(true);
    expect(await ledger.usedToday()).toBe(350);
  });

  it("release frees the reservation so the day budget is back", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    await ledger.reserve("a", 350);
    await ledger.reserve("b", 350);
    expect(await ledger.release("a")).toBe(true);
    expect(await ledger.reserve("c", 350)).toEqual({ ok: true });
  });

  it("settle or release of an unknown run changes nothing", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    expect(await ledger.settle("nope")).toBe(false);
    expect(await ledger.release("nope")).toBe(false);
    expect(await ledger.usedToday()).toBe(0);
  });

  it("a settled run is not released again", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    await ledger.reserve("a", 350);
    await ledger.settle("a");
    expect(await ledger.release("a")).toBe(false);
    expect(await ledger.usedToday()).toBe(350);
  });
});

describe("day rollover and persistence", () => {
  it("resets the day total on the next Bangkok day", async () => {
    const storage = fakeStorage();
    let now = MORNING;
    const ledger = new LabSpendLedger(storage, () => now);
    await ledger.reserve("a", 350);
    await ledger.settle("a");
    await ledger.reserve("b", 350);
    await ledger.settle("b");
    await ledger.reserve("c", 300);
    await ledger.settle("c");
    expect(await ledger.reserve("d", 350)).toEqual({ ok: false, reason: "day_over_cap" });

    now = NEXT_DAY;
    expect(await ledger.reserve("d", 350)).toEqual({ ok: true });
  });

  it("a new ledger object over the same storage sees the same spend", async () => {
    const storage = fakeStorage();
    const first = new LabSpendLedger(storage, () => MORNING);
    await first.reserve("a", 350);
    await first.settle("a");
    const second = new LabSpendLedger(storage, () => MORNING);
    expect(await second.usedToday()).toBe(350);
  });
});

describe("fails closed", () => {
  it("refuses every run when the stored state cannot be read", async () => {
    const storage = fakeStorage();
    storage.failRead = true;
    const ledger = new LabSpendLedger(storage, () => MORNING);
    expect(await ledger.reserve("a", 10)).toEqual({ ok: false, reason: "ledger_unreadable" });
  });

  it("refuses every run when the stored state is malformed", async () => {
    const ledger = new LabSpendLedger(fakeStorage({ charged: { "2026-11-07": "lots" }, reservations: [] }), () => MORNING);
    expect(await ledger.reserve("a", 10)).toEqual({ ok: false, reason: "ledger_unreadable" });
  });

  it("does not record a reservation when the write fails", async () => {
    const storage = fakeStorage();
    storage.failWrite = true;
    const ledger = new LabSpendLedger(storage, () => MORNING);
    expect(await ledger.reserve("a", 10)).toEqual({ ok: false, reason: "ledger_unreadable" });
    storage.failWrite = false;
    expect(await ledger.usedToday()).toBe(0);
  });
});

describe("the caps are the approved numbers", () => {
  it("is 350 per run and 1000 per day", () => {
    expect(LAB_LEDGER_PER_RUN_CAP).toBe(350);
    expect(LAB_LEDGER_PER_DAY_CAP).toBe(1000);
  });
});

// ── atomic reservations, single-use run ids, restart persistence ─────────────
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileLedgerStorage } from "@/lib/lab/labSpendLedger";

/** Fake storage with a real async gap, so an unlocked check-then-write would race. */
function slowStorage(): LabLedgerStorage & { raw: string | null } {
  const store = {
    raw: null as string | null,
    async read() {
      await new Promise((r) => setTimeout(r, 2));
      return store.raw === null ? null : JSON.parse(store.raw);
    },
    async write(state: LabLedgerState) {
      await new Promise((r) => setTimeout(r, 2));
      store.raw = JSON.stringify(state);
    },
  };
  return store;
}

describe("concurrency: reservations are atomic", () => {
  it("ten simultaneous 350 reservations: exactly two fit under the 1000 day cap", async () => {
    const ledger = new LabSpendLedger(slowStorage(), () => MORNING);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => ledger.reserve(`run-${i}`, 350))
    );
    const ok = results.filter((r) => r.ok).length;
    const dayRefused = results.filter((r) => !r.ok && r.reason === "day_over_cap").length;
    expect(ok).toBe(2);
    expect(dayRefused).toBe(8);
    expect(await ledger.usedToday()).toBe(700);
  });

  it("a settle racing a reserve never loses a credit", async () => {
    const storage = slowStorage();
    const ledger = new LabSpendLedger(storage, () => MORNING);
    await ledger.reserve("a", 350);
    const [settled, rb, rc] = await Promise.all([ledger.settle("a"), ledger.reserve("b", 350), ledger.reserve("c", 350)]);
    expect(settled).toBe(true);
    expect(rb).toEqual({ ok: true });
    // 350 charged + 350 for b = 700; c would make 1050, so it is refused.
    expect(rc).toEqual({ ok: false, reason: "day_over_cap" });
    expect(await ledger.usedToday()).toBe(700);
  });
});

describe("single-use run ids (duplicate triggers)", () => {
  it("refuses the same run id twice while it is reserved", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    expect(await ledger.reserve("same", 100)).toEqual({ ok: true });
    expect(await ledger.reserve("same", 100)).toEqual({ ok: false, reason: "duplicate_run" });
  });
  it("refuses the same run id again after it was settled", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    await ledger.reserve("same", 100);
    await ledger.settle("same");
    expect(await ledger.reserve("same", 100)).toEqual({ ok: false, reason: "duplicate_run" });
  });
  it("refuses the same run id again after it was released", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    await ledger.reserve("same", 100);
    await ledger.release("same");
    expect(await ledger.reserve("same", 100)).toEqual({ ok: false, reason: "duplicate_run" });
  });
  it("refuses an empty run id", async () => {
    const ledger = new LabSpendLedger(fakeStorage(), () => MORNING);
    expect(await ledger.reserve("", 100)).toEqual({ ok: false, reason: "duplicate_run" });
  });
});

describe("restart persistence (file storage)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lab-ledger-"));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("a new process sees the charged spend from the file", async () => {
    const file = path.join(dir, "ledger.json");
    const first = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    await first.reserve("a", 350);
    await first.settle("a");
    const restarted = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    expect(await restarted.usedToday()).toBe(350);
  });

  it("an unsettled reservation survives a restart and still counts toward the cap", async () => {
    const file = path.join(dir, "ledger.json");
    const first = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    await first.reserve("a", 350);
    await first.reserve("b", 350);
    const restarted = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    expect(await restarted.reserve("c", 350)).toEqual({ ok: false, reason: "day_over_cap" });
  });

  it("a restarted process still refuses a run id used before the restart", async () => {
    const file = path.join(dir, "ledger.json");
    await new LabSpendLedger(createFileLedgerStorage(file), () => MORNING).reserve("a", 10);
    const restarted = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    expect(await restarted.reserve("a", 10)).toEqual({ ok: false, reason: "duplicate_run" });
  });

  it("a failed write leaves the previous complete file in place", async () => {
    const file = path.join(dir, "ledger.json");
    const ledger = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    await ledger.reserve("a", 100);
    const before = await fsp.readFile(file, "utf8");
    jest.spyOn(fsp, "rename").mockRejectedValueOnce(new Error("crash during rename"));
    expect(await ledger.reserve("b", 100)).toEqual({ ok: false, reason: "ledger_unreadable" });
    expect(await fsp.readFile(file, "utf8")).toBe(before);
    expect(JSON.parse(before).reservations.map((r: { runId: string }) => r.runId)).toEqual(["a"]);
  });

  it("a corrupt file fails closed", async () => {
    const file = path.join(dir, "ledger.json");
    await fsp.writeFile(file, "{not json", "utf8");
    const ledger = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    expect(await ledger.reserve("a", 10)).toEqual({ ok: false, reason: "ledger_unreadable" });
  });

  it("a missing file starts an empty ledger", async () => {
    const file = path.join(dir, "absent", "ledger.json");
    const ledger = new LabSpendLedger(createFileLedgerStorage(file), () => MORNING);
    expect(await ledger.reserve("a", 350)).toEqual({ ok: true });
  });
});

// ── interprocess lock, fail-closed contention, rollover keeps reservations ───
import { createFileLock, noLabLock, LAB_LEDGER_TIME_ZONE } from "@/lib/lab/labSpendLedger";

describe("interprocess lock: separate ledger objects cannot overspend", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "lab-lock-"));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("ten simultaneous reserves across three ledger objects on one file: exactly two fit", async () => {
    const file = path.join(dir, "ledger.json");
    const lock = createFileLock(path.join(dir, "ledger.lock"), { retryMs: 5, timeoutMs: 20_000 });
    const ledgers = [0, 1, 2].map(
      () => new LabSpendLedger(createFileLedgerStorage(file), () => MORNING, LAB_LEDGER_TIME_ZONE, lock)
    );
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => ledgers[i % 3].reserve(`run-${i}`, 350))
    );
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(await ledgers[0].usedToday()).toBe(700);
  });

  it("fails closed when the lock is held and cannot be taken in time", async () => {
    const lockPath = path.join(dir, "ledger.lock");
    await fsp.writeFile(lockPath, "{}", "utf8"); // held by someone, fresh
    const lock = createFileLock(lockPath, { timeoutMs: 60, retryMs: 5, staleMs: 60_000 });
    const ledger = new LabSpendLedger(createFileLedgerStorage(path.join(dir, "ledger.json")), () => MORNING, LAB_LEDGER_TIME_ZONE, lock);
    expect(await ledger.reserve("a", 100)).toEqual({ ok: false, reason: "ledger_unreadable" });
    expect(await ledger.settle("a")).toBe(false);
    expect(await ledger.usedToday()).toBeNull();
    // Nothing was written while the lock was held by someone else.
    await expect(fsp.access(path.join(dir, "ledger.json"))).rejects.toThrow();
  });

  it("removes a stale lock left by a crashed runner and proceeds", async () => {
    const lockPath = path.join(dir, "ledger.lock");
    await fsp.writeFile(lockPath, "{}", "utf8");
    const old = new Date(Date.now() - 10 * 60_000);
    await fsp.utimes(lockPath, old, old);
    const lock = createFileLock(lockPath, { staleMs: 5 * 60_000, timeoutMs: 1000, retryMs: 5 });
    const ledger = new LabSpendLedger(createFileLedgerStorage(path.join(dir, "ledger.json")), () => MORNING, LAB_LEDGER_TIME_ZONE, lock);
    expect(await ledger.reserve("a", 100)).toEqual({ ok: true });
    // The lock is released afterwards.
    await expect(fsp.access(lockPath)).rejects.toThrow();
  });

  it("releases the lock even when a write fails", async () => {
    const lockPath = path.join(dir, "ledger.lock");
    const lock = createFileLock(lockPath, { timeoutMs: 500, retryMs: 5 });
    const storage = { read: async () => null, write: async () => { throw new Error("disk"); } };
    const ledger = new LabSpendLedger(storage, () => MORNING, LAB_LEDGER_TIME_ZONE, lock);
    expect(await ledger.reserve("a", 100)).toEqual({ ok: false, reason: "ledger_unreadable" });
    await expect(fsp.access(lockPath)).rejects.toThrow();
  });
});

describe("day rollover keeps outstanding reservations", () => {
  it("a run still reserved after midnight still counts toward the new day", async () => {
    const storage = fakeStorage();
    let now = MORNING;
    const ledger = new LabSpendLedger(storage, () => now);
    await ledger.reserve("crashed", 350);
    now = NEXT_DAY;
    expect(await ledger.usedToday()).toBe(350);
    // 350 still outstanding + 350 = 700: fits. + another 350 = 1050: refused.
    expect(await ledger.reserve("new1", 350)).toEqual({ ok: true });
    expect(await ledger.reserve("new2", 350)).toEqual({ ok: false, reason: "day_over_cap" });
  });

  it("a run charged yesterday no longer uses today's budget", async () => {
    const storage = fakeStorage();
    let now = MORNING;
    const ledger = new LabSpendLedger(storage, () => now);
    await ledger.reserve("a", 350);
    await ledger.settle("a");
    now = NEXT_DAY;
    expect(await ledger.usedToday()).toBe(0);
    expect(await ledger.reserve("b", 350)).toEqual({ ok: true });
  });
});
