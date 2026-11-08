import { labRunsForRequest } from "@/lib/lab/labAdminView";

const storageWith = (state: unknown) => ({ read: async () => state, write: async () => undefined });

describe("labRunsForRequest (read-only)", () => {
  it("lists only the runs linked to this request, with their status", async () => {
    const runs = await labRunsForRequest(
      storageWith({
        runBindings: {
          "owner-1::run-a": { requestId: "req-1", attemptIds: ["att-1", "att-2"], uploadAuthorised: ["att-1"] },
          "owner-1::run-b": { requestId: "req-2", attemptIds: [], uploadAuthorised: [] },
        },
        spendAttempted: ["owner-1::run-a"],
        reservations: [{ runId: "owner-1::run-a", credits: 341 }],
        unresolvedClaims: [{ key: "owner-1::run-a" }],
      }),
      "req-1"
    );
    expect(runs).toEqual([
      { runId: "run-a", attemptCount: 2, uploadsAuthorised: 1, markerRecorded: true, reservedCredits: 341, unresolvedClaims: 1 },
    ]);
  });

  it("no ledger file yet: no runs (an empty list, not an error)", async () => {
    expect(await labRunsForRequest(storageWith(null), "req-1")).toEqual([]);
  });

  it("an unreadable ledger is reported as unknown (null), never as 'no runs'", async () => {
    const broken = { read: async () => { throw new Error("disk gone"); }, write: async () => undefined };
    expect(await labRunsForRequest(broken, "req-1")).toBeNull();
    expect(await labRunsForRequest(storageWith("garbage"), "req-1")).toBeNull();
  });

  it("never writes", async () => {
    const write = jest.fn(async () => undefined);
    await labRunsForRequest({ read: async () => ({ runBindings: {} }), write }, "req-1");
    expect(write).not.toHaveBeenCalled();
  });
});
