import {
  defaultLabScenePlan,
  labAutoRunEnabled,
  labCapRefusal,
  runLabAutoRun,
  LAB_PER_DAY_CREDIT_CAP,
  LAB_PER_RUN_CREDIT_CAP,
  type LabRunDeps,
} from "@/features/requests/labAutoRun";

type Content = Awaited<ReturnType<LabRunDeps["waitForContent"]>>;

const CONTENT: Content = {
  jobId: "job-1",
  scenes: [
    { summary: "scene one", sourceIndexes: [0, 1], durationSeconds: 6 },
    { summary: "scene two", sourceIndexes: [2], durationSeconds: 4 },
  ],
  sourceKinds: ["clip", "image", "clip"],
  platforms: ["tiktok"],
  voiceId: "voice-x",
  script: { text: "ข้อความ", english: "text", caption: "c", captionEnglish: "c", captionChinese: "c" },
};

function makeDeps(over: Partial<Record<keyof LabRunDeps, unknown>> = {}) {
  const calls: string[] = [];
  const rec = <T extends (...args: never[]) => unknown>(name: string, impl: T) =>
    jest.fn(async (...args: Parameters<T>) => {
      calls.push(name);
      return (impl as (...a: Parameters<T>) => unknown)(...args);
    });

  const deps = {
    fetchTestMedia: rec("fetchTestMedia", async (name: string) => new File(["x"], name, { type: "video/mp4" })),
    quoteCapState: rec("quoteCapState", async () => ({ spentTodayCredits: 0, quotedRunCredits: 100 })),
    createDraft: rec("createDraft", async () => "req-1"),
    beforeSpend: rec("beforeSpend", async () => undefined),
    submit: rec("submit", async () => undefined),
    waitForContent: rec("waitForContent", async () => CONTENT),
    approveContent: rec("approveContent", async () => undefined),
    waitForVoice: rec("waitForVoice", async () => undefined),
    approveVoice: rec("approveVoice", async () => undefined),
    approveProduction: rec("approveProduction", async () => undefined),
    waitForRender: rec("waitForRender", async () => ({ outputIds: ["out-1", "out-2"], materialIds: ["mat-1", "mat-2"] })),
    uploadAndConfirm: rec("uploadAndConfirm", async (_req: string, id: string) => id === "out-1"),
    approveVideo: rec("approveVideo", async () => undefined),
    deleteLabMaterials: rec("deleteLabMaterials", async () => undefined),
    deleteLabOutputs: rec("deleteLabOutputs", async () => undefined),
    ...over,
  } as unknown as LabRunDeps;
  return { deps, calls };
}

const ON = { flag: "true", fileNames: ["a.mp4", "b.mp4"] };

describe("flag", () => {
  it("is on only for exactly 'true'", () => {
    expect(labAutoRunEnabled("true")).toBe(true);
    expect(labAutoRunEnabled("TRUE")).toBe(false);
    expect(labAutoRunEnabled("1")).toBe(false);
    expect(labAutoRunEnabled(undefined)).toBe(false);
  });

  it("makes no calls at all when off", async () => {
    const { deps, calls } = makeDeps();
    const result = await runLabAutoRun(deps, { flag: undefined, fileNames: ["a.mp4"] });
    expect(result).toEqual({ status: "disabled" });
    expect(calls).toEqual([]);
  });
});

describe("credit caps", () => {
  it("allows a run within both caps", () => {
    expect(labCapRefusal({ spentTodayCredits: 0, quotedRunCredits: LAB_PER_RUN_CREDIT_CAP })).toBeNull();
  });
  it("refuses a run over the per-run cap", () => {
    expect(labCapRefusal({ spentTodayCredits: 0, quotedRunCredits: LAB_PER_RUN_CREDIT_CAP + 1 })).toMatch(/^run_over_cap/);
  });
  it("refuses a run that would pass the per-day cap", () => {
    expect(labCapRefusal({ spentTodayCredits: LAB_PER_DAY_CREDIT_CAP - 100, quotedRunCredits: 200 })).toMatch(/^day_over_cap/);
  });
  it("refuses before any media, draft or submit call", async () => {
    const { deps } = makeDeps({
      quoteCapState: jest.fn(async () => ({ spentTodayCredits: 0, quotedRunCredits: 999 })),
    });
    const result = await runLabAutoRun(deps, ON);
    expect(result).toMatchObject({ status: "refused" });
    expect(deps.fetchTestMedia).not.toHaveBeenCalled();
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });
});

describe("happy path order", () => {
  it("runs every step in order and returns the confirmed outputs", async () => {
    const { deps, calls } = makeDeps();
    const result = await runLabAutoRun(deps, ON);
    expect(calls).toEqual([
      "quoteCapState",
      "fetchTestMedia",
      "fetchTestMedia",
      "createDraft",
      "beforeSpend",
      "submit",
      "waitForContent",
      "approveContent",
      "waitForVoice",
      "approveVoice",
      "approveProduction",
      "waitForRender",
      "deleteLabMaterials",
      "uploadAndConfirm",
      "uploadAndConfirm",
      "approveVideo",
      "deleteLabOutputs",
    ]);
    expect(result).toEqual({ status: "done", requestId: "req-1", outputIds: ["out-1"], keptOutputIds: ["out-2"] });
  });
});

describe("deletion rules", () => {
  it("deletes sources only after the render, and only the run's own materials", async () => {
    const { deps, calls } = makeDeps();
    await runLabAutoRun(deps, ON);
    expect(calls.indexOf("deleteLabMaterials")).toBeGreaterThan(calls.indexOf("waitForRender"));
    expect(deps.deleteLabMaterials).toHaveBeenCalledWith(["mat-1", "mat-2"]);
  });

  it("deletes only outputs whose upload was confirmed, after the upload", async () => {
    const { deps, calls } = makeDeps();
    await runLabAutoRun(deps, ON);
    expect(deps.deleteLabOutputs).toHaveBeenCalledWith(["out-1"]);
    expect(calls.indexOf("deleteLabOutputs")).toBeGreaterThan(calls.lastIndexOf("uploadAndConfirm"));
  });

  it("keeps every output and deletes none when no upload is confirmed", async () => {
    const { deps } = makeDeps({ uploadAndConfirm: jest.fn(async () => false) });
    const result = await runLabAutoRun(deps, ON);
    expect(deps.deleteLabOutputs).toHaveBeenCalledWith([]);
    expect(result).toMatchObject({ status: "done", outputIds: [], keptOutputIds: ["out-1", "out-2"] });
  });

  it("never deletes outputs when the run fails before upload", async () => {
    const { deps } = makeDeps({ waitForRender: jest.fn(async () => { throw new Error("render_failed"); }) });
    const result = await runLabAutoRun(deps, ON);
    expect(deps.deleteLabOutputs).not.toHaveBeenCalled();
    expect(deps.deleteLabMaterials).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "failed", step: "render", error: "render_failed", requestId: "req-1" });
  });

  it("stops at the step that fails and reports it", async () => {
    const { deps, calls } = makeDeps({ approveVoice: jest.fn(async () => { throw new Error("voice_too_long"); }) });
    const result = await runLabAutoRun(deps, ON);
    expect(result).toMatchObject({ status: "failed", step: "voice" });
    expect(calls).not.toContain("approveProduction");
    expect(calls).not.toContain("deleteLabMaterials");
  });
});

describe("defaultLabScenePlan", () => {
  it("builds one scene per storyboard scene with centred, static shots", () => {
    const plan = defaultLabScenePlan(CONTENT.scenes, CONTENT.sourceKinds);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ sceneNumber: 1, durationSeconds: 6, visualDescriptionThai: "scene one", imageIndexes: [0, 1] });
    expect(plan[0].assets.map((a) => a.assetIndex)).toEqual([0, 1]);
    for (const asset of plan.flatMap((p) => p.assets)) {
      expect(asset).toMatchObject({ motion: "static", focusX: 0.5, focusY: 0.5, frameZoom: 1 });
    }
  });

  it("skips shots that point at a missing source", () => {
    const plan = defaultLabScenePlan([{ summary: "x", sourceIndexes: [9], durationSeconds: 3 }], ["clip"]);
    expect(plan).toEqual([]);
  });
});
