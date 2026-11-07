/**
 * Mapping tests for the production binding. The real studio functions are
 * replaced by mocks, so these tests check the arguments each one receives.
 * Nothing is sent, charged, rendered or deleted.
 */
jest.mock("@/features/device-render/studioPipeline", () => ({
  submitStudioRequest: jest.fn(async () => undefined),
  fetchStudioContent: jest.fn(),
  approveStudioContent: jest.fn(async () => undefined),
  approveStudioVoice: jest.fn(async () => undefined),
  approveStudioProduction: jest.fn(async () => undefined),
  approveStudioVideo: jest.fn(async () => undefined),
}));
jest.mock("@/features/requests/localMediaStore", () => ({
  loadLocalMediaIndex: jest.fn(async () => new Map()),
}));
jest.mock("@/lib/mobile/deviceRenderClient", () => ({
  runDeviceRender: jest.fn(async () => ({ status: "refused", reason: "no_render_queued" })),
}));

import * as studio from "@/features/device-render/studioPipeline";
import * as store from "@/features/requests/localMediaStore";
import { runDeviceRender } from "@/lib/mobile/deviceRenderClient";
import {
  createLabStudioIo,
  labScenesFromStoryboard,
  labTestPlaceFromEnv,
  LAB_EDITOR_DEFAULTS,
  toStoryboardPlan,
  toStudioScenePlan,
} from "@/lib/lab/labStudioIo";
import { RunArtifactRegistry } from "@/lib/lab/labRuntime";
import { neverStopped, type LabLiveGuard } from "@/lib/lab/labGuards";
import type { LabLedgerState } from "@/lib/lab/labSpendLedger";

const studioMock = studio as unknown as Record<string, jest.Mock>;
const storeMock = store as unknown as { loadLocalMediaIndex: jest.Mock };
const renderMock = runDeviceRender as unknown as jest.Mock;

function deps(over: Partial<Parameters<typeof createLabStudioIo>[0]> = {}) {
  return {
    ledger: { usedToday: async () => 0 },
    guard: neverStopped as LabLiveGuard,
    registry: new RunArtifactRegistry(),
    runId: "run-1",
    prepareSource: async (file: File) => ({ posterUrl: "data:image/jpeg;base64,xx", durationSeconds: 15, previewUrl: `blob:${file.name}`, release: jest.fn() }),
    testPlace: { placeName: "Test place", latitude: 13.75, longitude: 100.5 },
    fetchJson: jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ requestId: "req-1" }) })),
    fetchBlob: jest.fn(async () => new Blob(["x"], { type: "video/mp4" })),
    maxRenderSteps: 5,
    ...over,
  } as Parameters<typeof createLabStudioIo>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  storeMock.loadLocalMediaIndex.mockImplementation(async () => new Map());
});

describe("pure mappings", () => {
  it("storyboard: lab scenes -> the editor's storyboard shape, same zero-based indexes", () => {
    expect(toStoryboardPlan([{ summary: "a", sourceIndexes: [0, 2], durationSeconds: 5 }])).toEqual([
      { sceneNumber: 1, summary: "a", assetIndexes: [0, 2] },
    ]);
  });

  it("scene plan: first scene is a cut, the rest use the editor's default transition", () => {
    const plan = toStudioScenePlan([
      { sceneNumber: 1, durationSeconds: 5, visualDescriptionThai: "x", imageIndexes: [0], assets: [{ assetIndex: 0, kind: "clip", motion: "static", durationSeconds: 5, focusX: 0.5, focusY: 0.5, frameZoom: 1 }] },
      { sceneNumber: 2, durationSeconds: 5, visualDescriptionThai: "y", imageIndexes: [1], assets: [{ assetIndex: 1, kind: "clip", motion: "static", durationSeconds: 5, focusX: 0.5, focusY: 0.5, frameZoom: 1 }] },
    ]);
    expect(plan.map((p) => p.transitionIn)).toEqual(["cut", "fade"]);
  });

  it("lab scenes from the server storyboard split the fixed 15 seconds evenly", () => {
    const scenes = labScenesFromStoryboard([
      { sceneNumber: 1, summary: "a", assetIndexes: [0] },
      { sceneNumber: 2, summary: "b", assetIndexes: [1] },
      { sceneNumber: 3, summary: "c", assetIndexes: [2] },
    ]);
    expect(scenes.map((s) => s.durationSeconds)).toEqual([5, 5, 5]);
    expect(scenes.map((s) => s.sourceIndexes)).toEqual([[0], [1], [2]]);
  });

  it("the editor defaults are the ones the editor starts with", () => {
    expect(LAB_EDITOR_DEFAULTS).toMatchObject({ templateId: "none", textStyle: "auto", musicTrackId: null, subtitleLanguages: ["en", "zh"] });
    expect(LAB_EDITOR_DEFAULTS.platforms).toEqual(["tiktok"]);
  });

  it("the test place comes only from configuration, and is absent when not set", () => {
    expect(labTestPlaceFromEnv({})).toBeNull();
    expect(labTestPlaceFromEnv({ LAB_TEST_PLACE_NAME: "P", LAB_TEST_PLACE_LAT: "13.7", LAB_TEST_PLACE_LNG: "100.5" })).toEqual({
      placeName: "P",
      latitude: 13.7,
      longitude: 100.5,
    });
  });
});

describe("each method calls the real studio function with the mapped arguments", () => {
  it("createDraft posts the form to the lab draft route and returns the request id", async () => {
    const d = deps();
    const io = createLabStudioIo(d);
    const id = await io.createDraft({ title: "Lab test clip", placeName: "P", latitude: 1, longitude: 2, description: "" });
    expect(id).toBe("req-1");
    expect((d.fetchJson as jest.Mock).mock.calls[0][0]).toBe("/api/lab/autorun/draft");
  });

  it("createDraft refuses a non-OK answer", async () => {
    const io = createLabStudioIo(deps({ fetchJson: jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) }));
    await expect(io.createDraft({ title: "t", placeName: "p", latitude: 1, longitude: 2, description: "" })).rejects.toThrow(/refused \(404\)/);
  });

  it("fetchTestMedia reads the lab test-media route and returns a File", async () => {
    const d = deps();
    const file = await createLabStudioIo(d).fetchTestMedia("clip.mp4");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("clip.mp4");
    expect((d.fetchBlob as jest.Mock).mock.calls[0][0]).toBe("/api/lab/test-media/clip.mp4");
  });

  it("spentTodayCredits reads the ledger, and refuses when it cannot be read", async () => {
    expect(await createLabStudioIo(deps({ ledger: { usedToday: async () => 350 } })).spentTodayCredits()).toBe(350);
    await expect(createLabStudioIo(deps({ ledger: { usedToday: async () => null } })).spentTodayCredits()).rejects.toThrow(/unreadable/);
  });

  it("submit calls submitStudioRequest with the clip sources, and records only the materials it added", async () => {
    let index = new Map<string, unknown>([["old-mat", {}]]);
    storeMock.loadLocalMediaIndex.mockImplementation(async () => index);
    studioMock.submitStudioRequest.mockImplementationOnce(async () => {
      index = new Map([...index, ["new-mat", {}]]);
    });
    const d = deps();
    const io = createLabStudioIo(d);
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    await io.submit("req-1", [file]);
    const arg = studioMock.submitStudioRequest.mock.calls[0][0];
    expect(arg.requestId).toBe("req-1");
    expect(arg.sources[0]).toMatchObject({ kind: "clip", fileName: "clip.mp4", durationSeconds: 15, file });
    // The run's materials are the ones added by submit; the render step reports them.
    renderMock.mockResolvedValueOnce({ status: "refused", reason: "no_render_queued" });
    const rendered = await io.waitForRender("req-1", "job-1");
    expect(rendered.materialIds).toEqual(["new-mat"]);
  });

  it("content maps a submitted request, and reports null before submit", async () => {
    const io = createLabStudioIo(deps());
    studioMock.fetchStudioContent.mockResolvedValueOnce({ submitted: false, jobId: null, storyboard: null, script: null, voice: null, localMedia: [] });
    expect(await io.content("req-1")).toBeNull();
    studioMock.fetchStudioContent.mockResolvedValueOnce({
      submitted: true,
      jobId: "job-1",
      storyboard: [{ sceneNumber: 1, summary: "a", assetIndexes: [0] }],
      script: { text: "t", english: "t", caption: "c", captionEnglish: "c", captionChinese: "c" },
      voice: null,
      localMedia: [{ mimeType: "video/mp4" }],
    });
    expect(await io.content("req-1")).toMatchObject({
      jobId: "job-1",
      voiceReady: false,
      platforms: ["tiktok"],
      sourceKinds: ["clip"],
      voiceId: LAB_EDITOR_DEFAULTS.voiceId,
    });
  });

  it("approveContent sends the storyboard in the editor's shape, with the default voice", async () => {
    const io = createLabStudioIo(deps());
    await io.approveContent("req-1", {
      script: { text: "t", english: "t", caption: "c", captionEnglish: "c", captionChinese: "c" },
      storyboard: [{ summary: "a", sourceIndexes: [0], durationSeconds: 15 }],
      voiceId: LAB_EDITOR_DEFAULTS.voiceId,
    });
    expect(studioMock.approveStudioContent).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-1", storyboard: [{ sceneNumber: 1, summary: "a", assetIndexes: [0] }] })
    );
  });

  it("approveVoice sends the editor's platform, and musicSelected exactly as the editor computes it", async () => {
    await createLabStudioIo(deps()).approveVoice("req-1", "job-1", ["tiktok"]);
    // The editor sends musicSelected = (musicTrackId !== "none"). Its default musicTrackId is null, so this is true.
    expect(studioMock.approveStudioVoice).toHaveBeenCalledWith({ requestId: "req-1", jobId: "job-1", platforms: ["tiktok"], musicSelected: true });
  });

  it("approveProduction sends the editor defaults and the 15 second length", async () => {
    await createLabStudioIo(deps()).approveProduction("req-1", "job-1", [
      { sceneNumber: 1, durationSeconds: 7.5, visualDescriptionThai: "x", imageIndexes: [0], assets: [{ assetIndex: 0, kind: "clip", motion: "static", durationSeconds: 7.5, focusX: 0.5, focusY: 0.5, frameZoom: 1 }] },
      { sceneNumber: 2, durationSeconds: 7.5, visualDescriptionThai: "y", imageIndexes: [1], assets: [{ assetIndex: 1, kind: "clip", motion: "static", durationSeconds: 7.5, focusX: 0.5, focusY: 0.5, frameZoom: 1 }] },
    ]);
    expect(studioMock.approveStudioProduction).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        durationSeconds: 15,
        musicTrackId: null,
        subtitleLanguages: ["en", "zh"],
        templateId: "none",
        textStyle: "auto",
      })
    );
  });

  it("approveVideo calls the real approval", async () => {
    await createLabStudioIo(deps()).approveVideo("req-1", "job-1");
    expect(studioMock.approveStudioVideo).toHaveBeenCalledWith({ requestId: "req-1", jobId: "job-1" });
  });
});

describe("render goes through the bounded driver, the real render, and the live guard", () => {
  it("passes the device's local media index to the real render", async () => {
    const index = new Map([["m1", { localId: "m1" }]]);
    storeMock.loadLocalMediaIndex.mockImplementation(async () => index);
    renderMock.mockResolvedValueOnce({ status: "refused", reason: "no_render_queued" });
    const io = createLabStudioIo(deps());
    await io.waitForRender("req-1", "job-1");
    expect(renderMock).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-1", localMedia: index }));
  });

  it("a stop from the live guard halts the render before any step is claimed", async () => {
    const guard: LabLiveGuard = { isStopped: () => true };
    const io = createLabStudioIo(deps({ guard }));
    await expect(io.waitForRender("req-1", "job-1")).rejects.toThrow();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("an upload is confirmed only through the adapter (never by the render alone)", async () => {
    renderMock.mockResolvedValueOnce({ status: "completed", assetId: "asset-1" });
    renderMock.mockResolvedValueOnce({ status: "refused", reason: "no_render_queued" });
    const io = createLabStudioIo(deps());
    const rendered = await io.waitForRender("req-1", "job-1");
    expect(rendered.outputIds).toEqual(["asset-1"]);
    expect(await io.uploadAndConfirm("req-1", "asset-1")).toBe(true);
    expect(await io.uploadAndConfirm("req-1", "not-confirmed")).toBe(false);
  });

  it("a stop between render steps: the next claim is not started", async () => {
    let stopped = false;
    const guard: LabLiveGuard = { isStopped: () => stopped };
    renderMock.mockImplementationOnce(async () => {
      stopped = true;
      return { status: "completed", assetId: "asset-1" };
    });
    const io = createLabStudioIo(deps({ guard }));
    await expect(io.waitForRender("req-1", "job-1")).rejects.toThrow();
    expect(renderMock).toHaveBeenCalledTimes(1);
  });
});

describe("the binding never deletes anything on its own", () => {
  it("the binding has no delete method; cleanup stays with the lab client, which refuses without a reviewed deleter", () => {
    const io = createLabStudioIo(deps()) as unknown as Record<string, unknown>;
    expect(io.deleteLabMaterials).toBeUndefined();
    expect(io.deleteLabOutputs).toBeUndefined();
    void ({} as LabLedgerState);
  });
});

describe("live guard before each direct normal-route call", () => {
  it("a stop before approveVoice: the studio function is not called", async () => {
    const guard: LabLiveGuard = { isStopped: () => true };
    await expect(createLabStudioIo(deps({ guard })).approveVoice("req-1", "job-1", ["tiktok"])).rejects.toThrow(/stopped/);
    expect(studioMock.approveStudioVoice).not.toHaveBeenCalled();
  });

  it("a stop before submit: no studio submit, and no preview URL is created", async () => {
    const guard: LabLiveGuard = { isStopped: () => true };
    const prepare = jest.fn();
    await expect(createLabStudioIo(deps({ guard, prepareSource: prepare })).submit("req-1", [new File(["x"], "a.mp4")])).rejects.toThrow(/stopped/);
    expect(studioMock.submitStudioRequest).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("a stop before draft creation: no draft request is sent", async () => {
    const guard: LabLiveGuard = { isStopped: () => true };
    const d = deps({ guard });
    await expect(createLabStudioIo(d).createDraft({ title: "t", placeName: "p", latitude: 1, longitude: 2, description: "" })).rejects.toThrow(/stopped/);
    expect(d.fetchJson).not.toHaveBeenCalled();
  });
});

describe("preview URLs are released after submit, success or failure, and the files are never touched", () => {
  it("success: every preview is released once", async () => {
    const release = jest.fn();
    const io = createLabStudioIo(deps({ prepareSource: async () => ({ posterUrl: "data:x", durationSeconds: 15, previewUrl: "blob:p", release }) }));
    await io.submit("req-1", [new File(["x"], "a.mp4")]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("failure of the studio submit: the preview is still released", async () => {
    const release = jest.fn();
    studioMock.submitStudioRequest.mockRejectedValueOnce(new Error("submit failed"));
    const io = createLabStudioIo(deps({ prepareSource: async () => ({ posterUrl: "data:x", durationSeconds: 15, previewUrl: "blob:p", release }) }));
    await expect(io.submit("req-1", [new File(["x"], "a.mp4")])).rejects.toThrow("submit failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
