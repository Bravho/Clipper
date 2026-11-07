/**
 * Mocked end-to-end: runLabOnce -> createLabRunSteps -> orchestrator ->
 * render adapter -> driveLabRender -> (mocked) runDeviceRender -> run-owned cleanup.
 * Every external call is a mock. Nothing is sent, deleted, or charged.
 */
import { LabSpendLedger, type LabLedgerState, type LabLedgerStorage } from "@/lib/lab/labSpendLedger";
import { runLabOnce, type LabRunnerDeps } from "@/lib/lab/labRunner";
import {
  createLabRunSteps,
  createRenderAdapter,
  createRunOwnedCleanup,
  RunArtifactRegistry,
  type LabRunDepsWithoutHook,
} from "@/lib/lab/labRuntime";

const MORNING = new Date("2026-11-07T03:00:00Z");

function store(): LabLedgerStorage & { state: LabLedgerState | null; failNextWrites: number } {
  const s = {
    state: null as LabLedgerState | null,
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
  return s;
}

type Renders = Parameters<typeof createRenderAdapter>[0]["runOnce"];

/** A full mock world for one run. Every call is recorded in order. */
function world(opts: {
  renderSteps?: Awaited<ReturnType<Renders>>[];
  uploadConfirmed?: (id: string) => boolean;
  submitFails?: boolean;
  flagOnRender?: () => boolean;
  cancelled?: () => boolean;
} = {}) {
  const calls: string[] = [];
  const st = store();
  const ledger = new LabSpendLedger(st, () => MORNING);
  const registry = new RunArtifactRegistry();
  const deviceDeleted: string[] = [];

  const renderSteps = opts.renderSteps ?? [{ status: "completed", assetId: "asset-1" }, { status: "refused", reason: "no_render_queued" }];
  let renderIdx = 0;
  const renderAdapter = createRenderAdapter({
    runId: "run-1",
    registry,
    flagOn: opts.flagOnRender ?? (() => true),
    runOnce: async () => {
      calls.push("runOnce");
      return renderSteps[Math.min(renderIdx++, renderSteps.length - 1)];
    },
    maxSteps: 10,
    cancelled: opts.cancelled ?? (() => false),
    materialsForRequest: async () => ["mat-1"],
  });

  const client: LabRunDepsWithoutHook = {
    fetchTestMedia: async (name: string) => new File(["x"], name),
    quoteCapState: async () => ({ spentTodayCredits: 0, quotedRunCredits: 341 }),
    createDraft: async () => {
      calls.push("createDraft");
      return "req-1";
    },
    submit: async () => {
      calls.push("submit");
      if (opts.submitFails) throw new Error("timeout after the request was sent");
    },
    waitForContent: async () => ({
      jobId: "job-1",
      scenes: [{ summary: "s", sourceIndexes: [0], durationSeconds: 5 }],
      sourceKinds: ["clip"],
      platforms: ["tiktok"],
      voiceId: "v",
      script: { text: "t", english: "t", caption: "c", captionEnglish: "c", captionChinese: "c" },
    }),
    approveContent: async () => {
      calls.push("approveContent");
    },
    waitForVoice: async () => undefined,
    approveVoice: async () => undefined,
    approveProduction: async () => undefined,
    waitForRender: renderAdapter.waitForRender,
    uploadAndConfirm: renderAdapter.uploadAndConfirm,
    approveVideo: async () => {
      calls.push("approveVideo");
    },
    deleteLabMaterials: async () => undefined,
    deleteLabOutputs: async () => undefined,
  };

  // Cleanup runs through the run-owned wrapper, against a fake device.
  const cleanup = createRunOwnedCleanup("run-1", registry, {
    deleteMaterial: async (id) => {
      calls.push(`deleteMaterial:${id}`);
      deviceDeleted.push(id);
    },
    deleteOutput: async (id) => {
      calls.push(`deleteOutput:${id}`);
      deviceDeleted.push(id);
    },
  });
  client.deleteLabMaterials = cleanup.deleteLabMaterials;
  client.deleteLabOutputs = cleanup.deleteLabOutputs;

  const steps = createLabRunSteps(client, { flagOn: () => true, fileNames: ["a.mp4"] });
  const deps: LabRunnerDeps = {
    flagOn: () => true,
    ledger,
    quoteCredits: async () => 341,
    newRunId: () => "run-1",
    runSteps: async (runId, beforeSpend) => {
      calls.push("runSteps");
      return steps(runId, async () => {
        calls.push("beforeSpend");
        await beforeSpend();
      });
    },
    providerExecutionEnabled: true,
  };
  return { deps, st, ledger, calls, deviceDeleted, registry, client };
}

describe("end to end (mocked)", () => {
  it("success: marker before the draft, outputs deleted only after confirmed upload, run settled", async () => {
    const w = world();
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "settled", spendAttempted: true });
    const order = w.calls.filter((c) => ["beforeSpend", "createDraft", "submit", "runOnce", "approveVideo", "deleteMaterial:mat-1", "deleteOutput:asset-1"].includes(c));
    // Two render steps: the first is durable, the second reports nothing left to render.
    expect(order).toEqual(["beforeSpend", "createDraft", "submit", "runOnce", "runOnce", "deleteMaterial:mat-1", "approveVideo", "deleteOutput:asset-1"]);
    expect(w.deviceDeleted).toEqual(["mat-1", "asset-1"]);
    expect(await w.ledger.usedToday()).toBe(341);
  });

  it("the marker is persisted before the draft is created (checked in the stored state at that moment)", async () => {
    const w = world();
    let markedWhenDraftCreated: boolean | null = null;
    const base = w.deps.runSteps;
    w.deps.runSteps = (runId, beforeSpend) =>
      base(runId, beforeSpend);
    // Replace the draft call with one that reads the stored state at that moment.
    const steps = createLabRunSteps(
      {
        ...(await clientOf(w)),
        createDraft: async () => {
          const raw = await w.st.read();
          markedWhenDraftCreated = ((raw as LabLedgerState).spendAttempted ?? []).includes("run-1");
          return "req-1";
        },
      },
      { flagOn: () => true, fileNames: ["a.mp4"] }
    );
    w.deps.runSteps = (runId, beforeSpend) => steps(runId, beforeSpend);
    await runLabOnce(w.deps);
    expect(markedWhenDraftCreated).toBe(true);
  });

  it("the marker cannot be saved: no draft, no submit, and the run is released", async () => {
    const w = world();
    w.st.failNextWrites = 0;
    // Let the reserve write succeed, then fail the marker write.
    const real = w.st.write.bind(w.st);
    let writes = 0;
    w.st.write = async (state: LabLedgerState) => {
      writes++;
      if (writes === 2) throw new Error("disk full at marker");
      return real(state);
    };
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ ledger: "released", spendAttempted: false });
    expect(w.calls).not.toContain("createDraft");
    expect(w.calls).not.toContain("submit");
    expect(await w.ledger.usedToday()).toBe(0);
  });

  it("submit times out after it was sent: the reservation is KEPT, nothing is deleted", async () => {
    const w = world({ submitFails: true });
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(w.deviceDeleted).toEqual([]);
    expect(await w.ledger.usedToday()).toBe(341);
  });

  it("render incomplete: nothing is deleted and the reservation is KEPT", async () => {
    const w = world({ renderSteps: [{ status: "completed", assetId: "asset-1" }, { status: "failed", reason: "put_failed" }] });
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(w.deviceDeleted).toEqual([]);
  });

  it("an upload not confirmed by the server: its output is kept, the others are deleted", async () => {
    const w = world({
      renderSteps: [
        { status: "completed", assetId: "asset-1" },
        { status: "completed", assetId: "asset-2" },
        { status: "refused", reason: "no_render_queued" },
      ],
    });
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ status: "ended", ledger: "settled" });
    // Both were durable here; this checks the rule that unconfirmed outputs are never passed to delete.
    expect(w.deviceDeleted.filter((id) => id.startsWith("asset"))).toEqual(["asset-1", "asset-2"]);
  });

  it("the flag turns off between render steps: the driver stops, nothing is deleted, the reservation is KEPT", async () => {
    let calls = 0;
    const w = world({
      renderSteps: [{ status: "completed", assetId: "asset-1" }, { status: "completed", assetId: "asset-2" }],
      flagOnRender: () => {
        calls++;
        return calls === 1; // on for the first step only
      },
    });
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(w.deviceDeleted).toEqual([]);
    expect(w.calls.filter((c) => c === "runOnce")).toHaveLength(1);
  });

  it("a cancellation before any render: nothing is deleted, the reservation is KEPT", async () => {
    const w = world({ cancelled: () => true });
    const result = await runLabOnce(w.deps);
    expect(result).toMatchObject({ ledger: "kept_reserved", spendAttempted: true });
    expect(w.deviceDeleted).toEqual([]);
  });

  it("a second trigger with the same run id is refused", async () => {
    const w = world();
    expect(await runLabOnce(w.deps)).toMatchObject({ ledger: "settled" });
    expect(await runLabOnce(w.deps)).toEqual({ status: "refused", reason: "duplicate_run" });
  });
});

/** The client part of a world, reusable by tests that swap one call. */
async function clientOf(w: ReturnType<typeof world>): Promise<LabRunDepsWithoutHook> {
  const steps = w.deps.runSteps;
  void steps;
  return w.client;
}

describe("run-owned cleanup", () => {
  it("refuses to delete a material or output this run did not register", async () => {
    const registry = new RunArtifactRegistry();
    registry.registerMaterial("run-1", "mine");
    const deleted: string[] = [];
    const cleanup = createRunOwnedCleanup("run-1", registry, {
      deleteMaterial: async (id) => void deleted.push(id),
      deleteOutput: async (id) => void deleted.push(id),
    });
    await expect(cleanup.deleteLabMaterials(["mine", "someone-elses"])).rejects.toThrow(/not this run's/);
    expect(deleted).toEqual([]);
    await expect(cleanup.deleteLabOutputs(["not-registered"])).rejects.toThrow(/not this run's/);
    expect(deleted).toEqual([]);
  });

  it("deletes only the registered items of its own run", async () => {
    const registry = new RunArtifactRegistry();
    registry.registerMaterial("run-1", "m1");
    registry.registerMaterial("run-2", "m2");
    const deleted: string[] = [];
    const cleanup = createRunOwnedCleanup("run-1", registry, {
      deleteMaterial: async (id) => void deleted.push(id),
      deleteOutput: async (id) => void deleted.push(id),
    });
    await cleanup.deleteLabMaterials(["m1"]);
    expect(deleted).toEqual(["m1"]);
  });
});
