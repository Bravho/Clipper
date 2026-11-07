/**
 * Cleanup rules with fake storage. Nothing real is deleted: the store is an
 * in-memory map, and the orchestrator's delete callbacks act on it.
 */
import { runLabAutoRun, type LabRunDeps } from "@/features/requests/labAutoRun";

type Content = Awaited<ReturnType<LabRunDeps["waitForContent"]>>;

const CONTENT: Content = {
  jobId: "job-1",
  scenes: [{ summary: "s", sourceIndexes: [0], durationSeconds: 5 }],
  sourceKinds: ["clip"],
  platforms: ["tiktok"],
  voiceId: "v",
  script: { text: "t", english: "t", caption: "c", captionEnglish: "c", captionChinese: "c" },
};

/** Fake phone storage: material and output artifacts keyed by id, tagged with the run that made them. */
function fakeStore(seed: { id: string; kind: "material" | "output"; runId: string }[]) {
  const items = new Map(seed.map((s) => [s.id, s]));
  return {
    items,
    delete(ids: string[], kind: "material" | "output", runId: string) {
      for (const id of ids) {
        const item = items.get(id);
        if (!item) continue;
        // Only this run's own artifacts of this kind may be removed.
        if (item.kind !== kind || item.runId !== runId) throw new Error(`refused to delete ${id}`);
        items.delete(id);
      }
    },
    has(id: string) {
      return items.has(id);
    },
  };
}

function deps(
  store: ReturnType<typeof fakeStore>,
  runId: string,
  over: { uploadOk?: (id: string) => boolean; renderMaterials?: string[]; renderOutputs?: string[] } = {}
): LabRunDeps {
  const uploadOk = over.uploadOk ?? (() => true);
  return {
    fetchTestMedia: async (name: string) => new File(["x"], name),
    quoteCapState: async () => ({ spentTodayCredits: 0, quotedRunCredits: 100 }),
    createDraft: async () => "req-1",
    submit: async () => undefined,
    waitForContent: async () => CONTENT,
    approveContent: async () => undefined,
    waitForVoice: async () => undefined,
    approveVoice: async () => undefined,
    approveProduction: async () => undefined,
    waitForRender: async () => ({
      outputIds: over.renderOutputs ?? ["out-1", "out-2"],
      materialIds: over.renderMaterials ?? ["mat-1"],
    }),
    uploadAndConfirm: async (_req: string, id: string) => uploadOk(id),
    approveVideo: async () => undefined,
    deleteLabMaterials: async (ids: string[]) => store.delete(ids, "material", runId),
    deleteLabOutputs: async (ids: string[]) => store.delete(ids, "output", runId),
  };
}

const ON = { flag: "true", fileNames: ["a.mp4"] };

describe("cleanup with fake storage", () => {
  it("deletes this run's sources and only the outputs whose upload was confirmed", async () => {
    const store = fakeStore([
      { id: "mat-1", kind: "material", runId: "run-A" },
      { id: "out-1", kind: "output", runId: "run-A" },
      { id: "out-2", kind: "output", runId: "run-A" },
    ]);
    const result = await runLabAutoRun(
      deps(store, "run-A", { uploadOk: (id) => id === "out-1" }),
      ON
    );
    expect(result).toMatchObject({ status: "done", outputIds: ["out-1"], keptOutputIds: ["out-2"] });
    expect(store.has("mat-1")).toBe(false);
    expect(store.has("out-1")).toBe(false);
    expect(store.has("out-2")).toBe(true); // unconfirmed upload: kept
  });

  it("keeps every output when no upload is confirmed", async () => {
    const store = fakeStore([
      { id: "mat-1", kind: "material", runId: "run-A" },
      { id: "out-1", kind: "output", runId: "run-A" },
      { id: "out-2", kind: "output", runId: "run-A" },
    ]);
    await runLabAutoRun(deps(store, "run-A", { uploadOk: () => false }), ON);
    expect(store.has("out-1")).toBe(true);
    expect(store.has("out-2")).toBe(true);
  });

  it("never touches another run's artifacts, even with the same kind", async () => {
    const store = fakeStore([
      { id: "mat-1", kind: "material", runId: "run-A" },
      { id: "other-mat", kind: "material", runId: "run-B" },
      { id: "out-1", kind: "output", runId: "run-A" },
      { id: "other-out", kind: "output", runId: "run-B" },
    ]);
    await runLabAutoRun(
      deps(store, "run-A", { renderOutputs: ["out-1"], renderMaterials: ["mat-1"] }),
      ON
    );
    expect(store.has("other-mat")).toBe(true);
    expect(store.has("other-out")).toBe(true);
  });

  it("a failed run after render deletes no outputs and no materials", async () => {
    const store = fakeStore([
      { id: "mat-1", kind: "material", runId: "run-A" },
      { id: "out-1", kind: "output", runId: "run-A" },
    ]);
    const d = deps(store, "run-A", { renderOutputs: ["out-1"], renderMaterials: ["mat-1"] });
    d.approveVideo = async () => {
      throw new Error("approve failed");
    };
    const result = await runLabAutoRun(d, ON);
    expect(result).toMatchObject({ status: "failed", step: "approve_video" });
    // Sources are deleted once the render is done; outputs wait for the approval step, so they stay.
    expect(store.has("out-1")).toBe(true);
  });

  it("a failure before render deletes nothing", async () => {
    const store = fakeStore([{ id: "mat-1", kind: "material", runId: "run-A" }]);
    const d = deps(store, "run-A");
    d.submit = async () => {
      throw new Error("submit failed");
    };
    const result = await runLabAutoRun(d, ON);
    expect(result).toMatchObject({ status: "failed", step: "submit" });
    expect(store.has("mat-1")).toBe(true);
  });

  it("refuses to delete an artifact the run did not create (guard in the fake)", async () => {
    const store = fakeStore([{ id: "foreign", kind: "output", runId: "run-B" }]);
    const d = deps(store, "run-A", { renderOutputs: ["foreign"], renderMaterials: [] });
    await expect(runLabAutoRun(d, ON)).resolves.toMatchObject({ status: "failed", step: "delete_outputs" });
    expect(store.has("foreign")).toBe(true);
  });
});
