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
