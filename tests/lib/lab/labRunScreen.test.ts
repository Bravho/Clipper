import { createPolledGuard } from "@/lib/lab/labLiveGuard";
import { labRunView, startLabRunFromScreen } from "@/lib/lab/labRunScreen";
import { LabSpendLedger } from "@/lib/lab/labSpendLedger";
import { neverStopped } from "@/lib/lab/labGuards";

describe("polled live guard", () => {
  it("starts stopped (fail closed) until a check says allowed", async () => {
    const g = createPolledGuard(async () => true);
    expect(g.isStopped()).toBe(true);
    await g.refresh();
    expect(g.isStopped()).toBe(false);
  });
  it("closes again when a later check says no, or throws", async () => {
    let answer: boolean | "throw" = true;
    const g = createPolledGuard(async () => {
      if (answer === "throw") throw new Error("offline");
      return answer;
    });
    await g.refresh();
    expect(g.isStopped()).toBe(false);
    answer = false;
    await g.refresh();
    expect(g.isStopped()).toBe(true);
    answer = true;
    await g.refresh();
    answer = "throw";
    await g.refresh();
    expect(g.isStopped()).toBe(true);
  });
});

describe("run screen", () => {
  it("with the production switch off, nothing is requested and the screen says so", async () => {
    const fetchJson = jest.fn();
    const view = await startLabRunFromScreen({
      flagValue: "true",
      identity: { flagValue: "true", labEmail: "lab@x.com", requesterRole: "requester", session: { user: { id: "1", role: "requester", email: "lab@x.com" } } },
      ledger: new LabSpendLedger({ read: async () => null, write: async () => undefined }),
      io: {} as never,
      clientOptions: { testPlace: { placeName: "P", latitude: 1, longitude: 2 }, waitMaxAttempts: 1, waitIntervalMs: 1 },
      guard: neverStopped,
      fileNames: ["a.mp4"],
      newRunId: () => "r",
    });
    expect(view.detail).toMatch(/switched off in this build/);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("maps every outcome to a plain message", () => {
    expect(labRunView({ status: "refused", reason: "stopped" }).detail).toMatch(/kill switch/);
    expect(labRunView({ status: "ended", runId: "r", outcome: { status: "done" }, ledger: "settled", spendAttempted: true }).title).toBe("Finished");
    expect(labRunView({ status: "ended", runId: "r", outcome: { status: "failed" }, ledger: "released", spendAttempted: false }).title).toBe("Stopped before any request");
    expect(labRunView({ status: "ended", runId: "r", outcome: { status: "failed" }, ledger: "kept_reserved", spendAttempted: true }).detail).toMatch(/kept/);
  });
});
