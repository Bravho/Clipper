import { labMaxRunCredits, LAB_FIXED_DURATION_SECONDS, LAB_FIXED_CHANNELS } from "@/lib/lab/labCostBasis";
import { unresolvedReservations, LabSpendLedger, type LabLedgerState } from "@/lib/lab/labSpendLedger";

describe("labMaxRunCredits (maximum basis for the cap)", () => {
  it("the fixed lab shape (15 s, one shape) fits under 350", () => {
    const basis = labMaxRunCredits(LAB_FIXED_DURATION_SECONDS, LAB_FIXED_CHANNELS);
    expect(basis).toEqual({ ok: true, maxCredits: 341, durationSeconds: 15, channels: 1 });
  });
  it("16 seconds is over the 350 cap and is refused", () => {
    expect(labMaxRunCredits(16, 1)).toEqual({ ok: false, reason: "over_cap", maxCredits: 363 });
  });
  it("refuses an unknown duration", () => {
    expect(labMaxRunCredits(undefined, 1)).toMatchObject({ ok: false, reason: "duration_unknown" });
    expect(labMaxRunCredits(Number.NaN, 1)).toMatchObject({ ok: false, reason: "duration_unknown" });
  });
  it("refuses a duration outside 0..90 seconds", () => {
    expect(labMaxRunCredits(0, 1)).toMatchObject({ ok: false, reason: "duration_out_of_range" });
    expect(labMaxRunCredits(91, 1)).toMatchObject({ ok: false, reason: "duration_out_of_range" });
  });
  it("refuses unknown or invalid channel counts", () => {
    expect(labMaxRunCredits(15, null)).toMatchObject({ ok: false, reason: "channels_unknown" });
    expect(labMaxRunCredits(15, 0)).toMatchObject({ ok: false, reason: "channels_unknown" });
    expect(labMaxRunCredits(15, 1.5)).toMatchObject({ ok: false, reason: "channels_unknown" });
  });
  it("more channels cost more and can push a run over the cap", () => {
    expect(labMaxRunCredits(15, 3)).toMatchObject({ ok: false, reason: "over_cap" });
  });
});

describe("unresolvedReservations (read-only)", () => {
  it("lists every reservation that was neither settled nor released", async () => {
    let state: LabLedgerState | null = null;
    const storage = {
      read: async () => (state === null ? null : JSON.parse(JSON.stringify(state))),
      write: async (s: LabLedgerState) => {
        state = JSON.parse(JSON.stringify(s));
      },
    };
    const ledger = new LabSpendLedger(storage, () => new Date("2026-11-07T03:00:00Z"));
    await ledger.reserve("a", 100);
    await ledger.reserve("b", 200);
    await ledger.settle("a");
    const before = JSON.parse(JSON.stringify(state));
    const report = await unresolvedReservations(storage);
    expect(report).toEqual({ count: 1, totalCredits: 200, runs: [expect.objectContaining({ runId: "b" })] });
    // Read-only: nothing changed.
    expect(JSON.parse(JSON.stringify(state))).toEqual(before);
  });
  it("reports an unreadable store as unknown (null), not as empty", async () => {
    const storage = { read: async () => ({ garbage: true }), write: async () => undefined };
    expect(await unresolvedReservations(storage)).toBeNull();
  });
});
