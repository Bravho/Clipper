import { LabSpendLedger, type LabLedgerState } from "@/lib/lab/labSpendLedger";
import { runLabEntry, type LabEntryInput } from "@/lib/lab/labEntry";
import type { LabIo, LabClientOptions } from "@/lib/lab/labClient";
import type { DeviceFileOps } from "@/lib/lab/labRuntime";
import { LAB_PROVIDER_EXECUTION_ENABLED } from "@/lib/lab/labGuards";

const MORNING = new Date("2026-11-07T03:00:00Z");
const LAB = "lab.tester@example.com";
const PLACE = { placeName: "Test place", latitude: 13.75, longitude: 100.5 };

/** A fake state store. Write 1 is the reservation, write 2 is the marker. */
function store(failMarkerWrite = false) {
  const s = {
    state: null as LabLedgerState | null,
    writes: 0,
    async read() {
      return s.state === null ? null : JSON.parse(JSON.stringify(s.state));
    },
    async write(state: LabLedgerState) {
      s.writes++;
      if (failMarkerWrite && s.writes === 2) throw new Error("disk full");
      s.state = JSON.parse(JSON.stringify(state));
    },
  };
  return s;
}

/** Every io method is a recorded mock. `calls` lists them in the order they ran. */
function makeIo(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const rec = (name: string, impl: (...args: unknown[]) => unknown) =>
    jest.fn(async (...args: unknown[]) => {
      calls.push(name);
      return impl(...args);
    });
  const mock = {
    fetchTestMedia: rec("fetchTestMedia", async (name) => new File(["x"], String(name))),
    spentTodayCredits: rec("spentTodayCredits", async () => 0),
    createDraft: rec("createDraft", async () => "req-1"),
    submit: rec("submit", async () => undefined),
    content: rec("content", async () => ({
      jobId: "job-1",
      scenes: [{ summary: "s", sourceIndexes: [0], durationSeconds: 5 }],
      script: { text: "t", english: "t", caption: "c", captionEnglish: "c", captionChinese: "c" },
      voiceId: "v",
      voiceReady: true,
      platforms: ["tiktok"],
      sourceKinds: ["clip"],
    })),
    approveContent: rec("approveContent", async () => undefined),
    approveVoice: rec("approveVoice", async () => undefined),
    approveProduction: rec("approveProduction", async () => undefined),
    approveVideo: rec("approveVideo", async () => undefined),
    waitForRender: rec("waitForRender", async () => ({ outputIds: ["out-1"], materialIds: ["mat-1"] })),
    uploadAndConfirm: rec("uploadAndConfirm", async () => true),
    ...over,
  };
  return { io: mock as unknown as LabIo, mock, calls };
}

function input(over: Partial<LabEntryInput> & { st?: ReturnType<typeof store> } = {}): LabEntryInput & { st: ReturnType<typeof store> } {
  const st = over.st ?? store();
  const base = makeIo();
  return {
    flagValue: "true",
    providerExecutionEnabled: true,
    identity: {
      flagValue: "true",
      labEmail: LAB,
      requesterRole: "requester",
      session: { user: { id: "lab-1", role: "requester", email: LAB } },
    },
    ledger: new LabSpendLedger(st, () => MORNING),
    io: base.io,
    clientOptions: { testPlace: PLACE, waitMaxAttempts: 3, waitIntervalMs: 1, sleep: async () => undefined } as LabClientOptions,
    fileNames: ["a.mp4"],
    newRunId: () => "run-1",
    ...over,
    st,
  };
}

describe("runLabEntry: nothing reaches the io before the guards", () => {
  it("flag off: no io call at all", async () => {
    const m = makeIo();
    expect(await runLabEntry(input({ flagValue: undefined, io: m.io }))).toEqual({ status: "refused", reason: "flag_off" });
    expect(m.calls).toEqual([]);
  });

  it("provider execution disabled: no io call at all, even with the right account", async () => {
    const m = makeIo();
    expect(await runLabEntry(input({ providerExecutionEnabled: false, io: m.io }))).toEqual({
      status: "refused",
      reason: "provider_execution_disabled",
    });
    expect(m.calls).toEqual([]);
  });

  it("wrong account: no io call at all", async () => {
    const m = makeIo();
    const r = await runLabEntry(
      input({
        io: m.io,
        identity: {
          flagValue: "true",
          labEmail: LAB,
          requesterRole: "requester",
          session: { user: { id: "x", role: "requester", email: "other@x.com" } },
        },
      })
    );
    expect(r).toMatchObject({ status: "refused" });
    expect(m.calls).toEqual([]);
  });

  it("the production constant is false, so the default entry refuses", () => {
    expect(LAB_PROVIDER_EXECUTION_ENABLED).toBe(false);
  });
});

describe("runLabEntry: marker before the first server write", () => {
  it("a failed marker write means no draft and no submit, and the run is released", async () => {
    const m = makeIo();
    const r = await runLabEntry(input({ io: m.io, st: store(true) }));
    expect(r).toMatchObject({ status: "ended", ledger: "released", spendAttempted: false });
    expect(m.calls).not.toContain("createDraft");
    expect(m.calls).not.toContain("submit");
  });

  it("the marker is in the stored state when the draft is created", async () => {
    const st = store();
    let markedAtDraft: boolean | null = null;
    const m = makeIo({
      createDraft: jest.fn(async () => {
        const raw = (await st.read()) as LabLedgerState;
        markedAtDraft = (raw.spendAttempted ?? []).includes("run-1");
        return "req-1";
      }),
    });
    await runLabEntry(input({ io: m.io, st }));
    expect(markedAtDraft).toBe(true);
  });
});

describe("runLabEntry: outcomes", () => {
  it("no test place: the draft is refused before any io call; the marker stays, so the reservation is kept", async () => {
    const m = makeIo();
    const r = await runLabEntry(
      input({ io: m.io, clientOptions: { testPlace: null, waitMaxAttempts: 3, waitIntervalMs: 1 } as LabClientOptions })
    );
    expect(r).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(m.calls).not.toContain("createDraft");
  });

  it("content never ready: the wait is bounded (three tries) and the reservation is kept", async () => {
    const m = makeIo({ content: jest.fn(async () => null) });
    const r = await runLabEntry(input({ io: m.io }));
    expect(r).toMatchObject({ ledger: "kept_reserved" });
    expect((m.mock.content as jest.Mock).mock.calls.length).toBe(3);
  });

  it("no device deletion configured: cleanup refuses, the files are kept, and approveVideo is not reached", async () => {
    const m = makeIo();
    const r = await runLabEntry(input({ io: m.io }));
    expect(r).toMatchObject({ ledger: "kept_reserved" });
    expect(m.calls).toContain("waitForRender");
    expect(m.calls).not.toContain("approveVideo");
  });

  it("a complete run with device deletions injected (tests only) settles the reservation", async () => {
    const deleted: string[] = [];
    const files: DeviceFileOps = {
      deleteMaterial: async (id) => void deleted.push(`m:${id}`),
      deleteOutput: async (id) => void deleted.push(`o:${id}`),
    };
    const m = makeIo();
    const r = await runLabEntry(
      input({
        io: m.io,
        clientOptions: { testPlace: PLACE, waitMaxAttempts: 3, waitIntervalMs: 1, sleep: async () => undefined, deviceFiles: files },
      })
    );
    expect(r).toMatchObject({ status: "ended", ledger: "settled", spendAttempted: true });
    expect(deleted).toEqual(["m:mat-1", "o:out-1"]);
    expect(m.calls.indexOf("submit")).toBeGreaterThan(m.calls.indexOf("createDraft"));
  });
});
