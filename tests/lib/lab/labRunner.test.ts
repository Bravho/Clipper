import { LabSpendLedger, type LabLedgerState, type LabLedgerStorage } from "@/lib/lab/labSpendLedger";
import { runLabOnce, type LabRunnerDeps, type LabRunOutcome } from "@/lib/lab/labRunner";

const MORNING = new Date("2026-11-07T03:00:00Z");

function storage(): LabLedgerStorage & { state: LabLedgerState | null } {
  const s = {
    state: null as LabLedgerState | null,
    async read() {
      return s.state === null ? null : JSON.parse(JSON.stringify(s.state));
    },
    async write(state: LabLedgerState) {
      s.state = JSON.parse(JSON.stringify(state));
    },
  };
  return s;
}

function harness(over: Partial<LabRunnerDeps> & { outcome?: (mark: () => void) => Promise<LabRunOutcome> } = {}) {
  const store = storage();
  const ledger = new LabSpendLedger(store, () => MORNING);
  let n = 0;
  const runSteps = jest.fn(over.outcome ?? (async () => ({ status: "done" as const })));
  const deps: LabRunnerDeps = {
    flagOn: () => true,
    ledger,
    quoteCredits: async () => 350,
    newRunId: () => `run-${++n}`,
    runSteps: (runId, mark) => runSteps(mark),
    ...over,
  } as LabRunnerDeps;
  return { deps, store, runSteps, ledger };
}

describe("runLabOnce: flag and caps", () => {
  it("does nothing at all when the flag is off", async () => {
    const h = harness({ flagOn: () => false });
    expect(await runLabOnce(h.deps)).toEqual({ status: "disabled" });
    expect(h.runSteps).not.toHaveBeenCalled();
    expect(h.store.state).toBeNull();
  });

  it("refuses before any step when the quote is over the per-run cap", async () => {
    const h = harness({ quoteCredits: async () => 351 });
    expect(await runLabOnce(h.deps)).toEqual({ status: "refused", reason: "run_over_cap" });
    expect(h.runSteps).not.toHaveBeenCalled();
  });

  it("refuses before any step when the day budget is used up", async () => {
    const h = harness();
    await h.ledger.reserve("earlier-1", 350);
    await h.ledger.reserve("earlier-2", 350);
    await h.ledger.reserve("earlier-3", 300);
    expect(await runLabOnce(h.deps)).toEqual({ status: "refused", reason: "day_over_cap" });
    expect(h.runSteps).not.toHaveBeenCalled();
  });
});

describe("runLabOnce: what happens to the reservation", () => {
  it("success: the reservation is settled and counts as spent", async () => {
    const h = harness();
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "settled" });
    expect(await h.ledger.usedToday()).toBe(350);
  });

  it("failure before any charging call: the reservation is released (known unspent)", async () => {
    const h = harness({
      outcome: async () => ({ status: "failed", step: "fetch" }),
    });
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "released" });
    expect(await h.ledger.usedToday()).toBe(0);
  });

  it("failure after submit was attempted: the reservation is KEPT (spend uncertain)", async () => {
    const h = harness({
      outcome: async (mark) => {
        mark();
        return { status: "failed", step: "submit" };
      },
    });
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "kept_reserved" });
    expect(await h.ledger.usedToday()).toBe(350);
  });

  it("a crash after submit was attempted is kept, even when the step is unknown", async () => {
    const h = harness({
      outcome: async (mark) => {
        mark();
        throw new Error("process died");
      },
    });
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "kept_reserved" });
    expect(await h.ledger.usedToday()).toBe(350);
  });

  it("a crash before any charging call is kept (not provably unspent), so nothing is freed by mistake", async () => {
    const h = harness({
      outcome: async () => {
        throw new Error("crash before submit");
      },
    });
    const result = await runLabOnce(h.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "kept_reserved" });
    expect(await h.ledger.usedToday()).toBe(350);
  });

  it("a cancellation without a step is kept, not released", async () => {
    const h = harness({ outcome: async () => ({ status: "cancelled" }) });
    expect(await runLabOnce(h.deps)).toMatchObject({ ledger: "kept_reserved" });
  });

  it("a kept reservation still blocks the next run after a restart of the runner", async () => {
    const h = harness({ outcome: async (mark) => (mark(), { status: "failed", step: "submit" }) });
    await runLabOnce(h.deps);
    const restarted = new LabSpendLedger(h.store, () => MORNING);
    // 350 kept from before the restart + 350 = 700 fits; a third 350 would be 1050.
    expect(await restarted.reserve("after-restart-1", 350)).toEqual({ ok: true });
    expect(await restarted.reserve("after-restart-2", 350)).toEqual({ ok: false, reason: "day_over_cap" });
  });

  it("each run gets its own id, so a repeat id is refused as a duplicate", async () => {
    const h = harness({ newRunId: () => "same-id" });
    expect(await runLabOnce(h.deps)).toMatchObject({ ledger: "settled" });
    expect(await runLabOnce(h.deps)).toEqual({ status: "refused", reason: "duplicate_run" });
  });
});
