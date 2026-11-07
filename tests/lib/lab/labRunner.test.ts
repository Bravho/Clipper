import { LabSpendLedger, type LabLedgerState, type LabLedgerStorage } from "@/lib/lab/labSpendLedger";
import { runLabOnce, SpendMarkerError, type LabRunnerDeps } from "@/lib/lab/labRunner";

const MORNING = new Date("2026-11-07T03:00:00Z");

/** Fake storage: JSON copy per write. Can be told to fail writes. */
function storage() {
  const s = {
    state: null as LabLedgerState | null,
    /** How many of the next writes should fail (one write = one persisted change). */
    failNextWrites: 0,
    async read() {
      return s.state === null ? null : JSON.parse(JSON.stringify(s.state));
    },
    async write(state: LabLedgerState) {
      if (s.failNextWrites > 0) {
        s.failNextWrites--;
        throw new Error("disk full");
      }
      s.state = JSON.parse(JSON.stringify(state));
    },
  };
  return s as typeof s & LabLedgerStorage;
}

type Steps = (runId: string, beforeSpend: () => Promise<void>) => Promise<{ status: "done" | "failed" | "cancelled"; step?: string }>;

function harness(steps: Steps, over: Partial<LabRunnerDeps> = {}) {
  const store = storage();
  const ledger = new LabSpendLedger(store, () => MORNING);
  let n = 0;
  const deps: LabRunnerDeps = {
    flagOn: () => true,
    ledger,
    quoteCredits: async () => 341,
    newRunId: () => `run-${++n}`,
    runSteps: steps,
    providerExecutionEnabled: true,
    ...over,
  };
  return { deps, store, ledger };
}

/** A dispatch helper: marks first, then "sends" (records the call). */
function dispatching(sent: string[], opts: { crashAfterMark?: boolean; crashAfterDispatch?: boolean; submitError?: boolean } = {}): Steps {
  return async (_runId, beforeSpend) => {
    await beforeSpend();
    if (opts.crashAfterMark) throw new Error("crash between marker and dispatch");
    sent.push("submit");
    if (opts.crashAfterDispatch) throw new Error("crash after dispatch");
    if (opts.submitError) return { status: "failed", step: "submit" };
    return { status: "done" };
  };
}

describe("gates", () => {
  it("does nothing when the flag is off", async () => {
    const sent: string[] = [];
    const h = harness(dispatching(sent), { flagOn: () => false });
    expect(await runLabOnce(h.deps)).toEqual({ status: "disabled" });
    expect(h.store.state).toBeNull();
    expect(sent).toEqual([]);
  });

  it("refuses everything while provider execution is disabled in code (the default)", async () => {
    const sent: string[] = [];
    const store = storage();
    const deps: LabRunnerDeps = {
      flagOn: () => true,
      ledger: new LabSpendLedger(store, () => MORNING),
      quoteCredits: async () => 341,
      newRunId: () => "r",
      runSteps: dispatching(sent),
    };
    expect(await runLabOnce(deps)).toEqual({ status: "refused", reason: "provider_execution_disabled" });
    expect(store.state).toBeNull();
    expect(sent).toEqual([]);
  });

  it("refuses an over-cap quote before any dispatch", async () => {
    const sent: string[] = [];
    const h = harness(dispatching(sent), { quoteCredits: async () => 351 });
    expect(await runLabOnce(h.deps)).toEqual({ status: "refused", reason: "run_over_cap" });
    expect(sent).toEqual([]);
  });
});

describe("marker before dispatch", () => {
  it("success: marker written, dispatched, settled", async () => {
    const sent: string[] = [];
    const h = harness(dispatching(sent));
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "settled", spendAttempted: true });
    expect(sent).toEqual(["submit"]);
    expect(await h.ledger.usedToday()).toBe(341);
  });

  it("marker cannot be persisted: nothing is dispatched and the run is released (no marker)", async () => {
    const sent: string[] = [];
    const h = harness(async (_r, beforeSpend) => {
      h.store.failNextWrites = 1; // only the marker write fails
      await beforeSpend();
      sent.push("submit");
      return { status: "done" };
    });
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "released", spendAttempted: false });
    expect(sent).toEqual([]);
    expect(await h.ledger.usedToday()).toBe(0);
  });

  it("crash between marker and dispatch: marker exists, reservation KEPT", async () => {
    const sent: string[] = [];
    const h = harness(dispatching(sent, { crashAfterMark: true }));
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(sent).toEqual([]);
    expect(await h.ledger.usedToday()).toBe(341);
  });

  it("crash after dispatch: reservation KEPT", async () => {
    const sent: string[] = [];
    const h = harness(dispatching(sent, { crashAfterDispatch: true }));
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(sent).toEqual(["submit"]);
  });

  it("a failed submit that returned an error after the marker: KEPT, not released", async () => {
    const sent: string[] = [];
    const h = harness(dispatching(sent, { submitError: true }));
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(await h.ledger.usedToday()).toBe(341);
  });

  it("a crash BEFORE the marker is attempted: no marker, so released as provably unspent", async () => {
    const h = harness(async () => {
      throw new Error("crash before any marker");
    });
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ ledger: "released", spendAttempted: false });
  });

  it("an unreadable ledger after a failure keeps the reservation (unknown, not released)", async () => {
    const sent: string[] = [];
    const store = storage();
    const ledger = new LabSpendLedger(store, () => MORNING);
    const deps: LabRunnerDeps = {
      flagOn: () => true,
      ledger: {
        reserve: ledger.reserve.bind(ledger),
        settle: ledger.settle.bind(ledger),
        release: ledger.release.bind(ledger),
        markSpendAttempt: ledger.markSpendAttempt.bind(ledger),
        hasSpendAttempt: async () => null,
      },
      quoteCredits: async () => 100,
      newRunId: () => "r",
      runSteps: async (_r, beforeSpend) => {
        await beforeSpend();
        sent.push("submit");
        return { status: "failed", step: "submit" };
      },
      providerExecutionEnabled: true,
    };
    const result = await runLabOnce(deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: null });
  });
});

describe("the ledger enforces the marker rules", () => {
  it("release is refused for a run that has a marker", async () => {
    const store = storage();
    const ledger = new LabSpendLedger(store, () => MORNING);
    await ledger.reserve("m", 100);
    expect(await ledger.markSpendAttempt("m")).toBe(true);
    expect(await ledger.release("m")).toBe(false);
    expect(await ledger.usedToday()).toBe(100);
  });

  it("the marker needs a reservation first", async () => {
    const ledger = new LabSpendLedger(storage(), () => MORNING);
    expect(await ledger.markSpendAttempt("no-such-run")).toBe(false);
  });

  it("a marker survives a restart", async () => {
    const store = storage();
    const first = new LabSpendLedger(store, () => MORNING);
    await first.reserve("m", 100);
    await first.markSpendAttempt("m");
    const restarted = new LabSpendLedger(store, () => MORNING);
    expect(await restarted.hasSpendAttempt("m")).toBe(true);
    expect(await restarted.release("m")).toBe(false);
  });

  it("the error type is what the orchestrator sees when the marker fails", () => {
    expect(new SpendMarkerError().name).toBe("SpendMarkerError");
  });
});
