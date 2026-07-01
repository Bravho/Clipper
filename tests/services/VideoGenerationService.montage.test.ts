/**
 * Phase 3 — real-media montage engine wired into the pipeline (the core swap).
 *
 * These suites exercise the montage path (the new default, `videoEngine`
 * undefined → montage). The Remotion render (`montageService.renderScene`) and
 * the segment concat (`ffmpegService.concatVideosWithCrossfade`) are mocked, so
 * no headless Chromium / FFmpeg runs. They assert the BATCH flow:
 *   - approving the scene design renders EVERY scene segment up front, then
 *     advances to the combined review (AwaitingVideoApproval),
 *   - "Approve all" concatenates every segment into baseVideoAssetId and
 *     advances to animation,
 *   - revising one scene re-renders only that scene (the others are kept),
 *   - retry re-renders the whole batch,
 *   - the renderer resolves each scene's asset indexes through the SAME
 *     canonical ordering used everywhere else (index alignment),
 *   - Veo is never touched on the montage path,
 *   - scene design fixes a concrete, index-aligned `assets[]` per scene, bakes
 *     subject-aware focus, and fails clearly with no usable media.
 *
 * Fresh Mock repos via `new Map()` per CLAUDE.md.
 */

import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockUploadedAssetRepository } from "@/repositories/mock/MockUploadedAssetRepository";
import { MockVideoGenerationJobRepository } from "@/repositories/mock/MockVideoGenerationJobRepository";
import { Platform } from "@/domain/enums/Platform";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { orderSourceAssets } from "@/lib/sourceAssets";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

jest.mock("@/repositories/index", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
  uploadedAssetRepository: new (require("@/repositories/mock/MockUploadedAssetRepository").MockUploadedAssetRepository)(new Map()),
  videoGenerationJobRepository: new (require("@/repositories/mock/MockVideoGenerationJobRepository").MockVideoGenerationJobRepository)(new Map()),
  videoPublishRecordRepository: new (require("@/repositories/mock/MockVideoPublishRecordRepository").MockVideoPublishRecordRepository)(new Map()),
}));

// ── Montage renderer mock — capture the props each scene renders with ───────
let renderSceneCallCount = 0;
const renderSceneMock = jest.fn(async (..._args: any[]) => {
  renderSceneCallCount += 1;
  return {
    storageKey: `montage/seg-${renderSceneCallCount}.mp4`,
    storageUrl: `https://cdn.example.com/montage/seg-${renderSceneCallCount}.mp4`,
    fileSizeBytes: 1000 + renderSceneCallCount,
  };
});
jest.mock("@/lib/ai/montageService", () => ({
  renderScene: (...args: unknown[]) => renderSceneMock(...args),
}));

// ── Veo must never be called on the montage path ────────────────────────────
const createVideoMock = jest.fn();
const extendVideoMock = jest.fn();
const pollTaskStatusMock = jest.fn();
const downloadAndStoreMock = jest.fn();
jest.mock("@/lib/ai/veoService", () => ({
  createVideo: (...args: unknown[]) => createVideoMock(...args),
  extendVideo: (...args: unknown[]) => extendVideoMock(...args),
  pollTaskStatus: (...args: unknown[]) => pollTaskStatusMock(...args),
  downloadAndStore: (...args: unknown[]) => downloadAndStoreMock(...args),
}));

// ── FFmpeg concat (segment assembly) + downstream compose stubs ─────────────
// The montage base is assembled via `concatVideosWithCrossfade`; route it to the
// same capture mock so the segment-order assertions hold.
const concatVideosMock = jest.fn(async (_keys: string[], outputKey: string) => ({
  storageKey: outputKey,
  storageUrl: `https://cdn.example.com/${outputKey}`,
  fileSizeBytes: 4242,
}));
const getRequiredRatiosForPlatformsMock = jest.fn((..._args: any[]) => ["9:16"]);
const composeAndExportMock = jest.fn();
const renderOverlayPreviewMock = jest.fn(async (..._args: any[]) => undefined);
jest.mock("@/lib/ai/ffmpegService", () => ({
  concatVideos: (...args: any[]) => concatVideosMock(args[0], args[1]),
  concatVideosWithCrossfade: (...args: any[]) => concatVideosMock(args[0], args[1]),
  getRequiredRatiosForPlatforms: (...args: unknown[]) => getRequiredRatiosForPlatformsMock(...args),
  composeAndExport: (...args: unknown[]) => composeAndExportMock(...args),
  renderOverlayPreview: (...args: unknown[]) => renderOverlayPreviewMock(...args),
}));

// ── Downstream animation chain stubbed so last-scene approval is quiet ───────
const generateAnimationSpecMock = jest.fn(async (..._args: any[]) => []);
jest.mock("@/lib/ai/animationService", () => ({
  generateAnimationSpec: (...args: unknown[]) => generateAnimationSpecMock(...args),
}));
const renderOverlayMock = jest.fn(async (..._args: any[]) => "https://cdn.example.com/overlay.webm");
jest.mock("@/lib/ai/remotionService", () => ({
  renderOverlay: (...args: unknown[]) => renderOverlayMock(...args),
}));
const generateAssSubtitlesMock = jest.fn((..._args: any[]) => "ASS");
const detectProductCoordinatesMock = jest.fn(async (..._args: any[]) => [] as any[]);
const alignAudioWithScriptMock = jest.fn(async (..._args: any[]) => [] as any[]);
jest.mock("@/lib/ai/geminiSubtitlesService", () => ({
  generateAssSubtitles: (...args: unknown[]) => generateAssSubtitlesMock(...args),
  detectProductCoordinates: (...args: unknown[]) => detectProductCoordinatesMock(...args),
  alignAudioWithScript: (...args: unknown[]) => alignAudioWithScriptMock(...args),
}));

// ── Vision scene design returns a Veo-shaped plan (imageIndexes, NO assets) ──
const generateSceneDesignFromScriptMock = jest.fn(async (_params: unknown) => ({
  scenePlan: [
    { sceneNumber: 1, durationSeconds: 7, visualDescriptionThai: "ฉาก 1", imageIndexes: [0] },
    { sceneNumber: 2, durationSeconds: 7, visualDescriptionThai: "ฉาก 2", imageIndexes: [1] },
  ],
  hookThai: "ฮุก",
  captionThai: "แคปชั่น",
  theme: "ธีม",
}));
jest.mock("@/lib/ai/chatGptVisionService", () => ({
  generateSceneDesignFromScript: (params: unknown) => generateSceneDesignFromScriptMock(params),
}));

jest.mock("@/services/BusinessProfileService", () => ({
  businessProfileService: {
    getProfile: jest.fn(async () => null),
    saveProfile: jest.fn(async () => undefined),
  },
}));

const {
  clipRequestRepository: mockClipRepo,
  uploadedAssetRepository: mockAssetRepo,
  videoGenerationJobRepository: mockJobRepo,
} = jest.requireMock("@/repositories/index") as {
  clipRequestRepository: MockClipRequestRepository;
  uploadedAssetRepository: MockUploadedAssetRepository;
  videoGenerationJobRepository: MockVideoGenerationJobRepository;
};

import { VideoGenerationService } from "@/services/VideoGenerationService";

const USER_ID = "user-001";

/**
 * Flush pending microtasks so fire-and-forget background renders complete.
 * The batch path renders every scene sequentially, so allow several ticks.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function createRequestWithImages(imageCount: number) {
  const request = await mockClipRepo.create({
    userId: USER_ID,
    title: "Montage Clip",
    description: "desc",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic",
    preferredLanguage: "Thai",
    durationSeconds: 14,
  });
  await mockClipRepo.updateStatus(request.id, RequestStatus.Editing, {});

  for (let i = 0; i < imageCount; i++) {
    await mockAssetRepo.create({
      requestId: request.id,
      userId: USER_ID,
      fileName: `photo${i}.jpg`,
      assetType: AssetType.Image,
      fileSizeBytes: 1024,
      mimeType: "image/jpeg",
      storageKey: `request_mat/photo${i}.jpg`,
      storageUrl: `https://cdn.example.com/photo${i}.jpg`,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  }
  return request;
}

/** A montage scene plan with concrete, index-aligned `assets`. */
const MONTAGE_PLAN: ScenePlan[] = [
  {
    sceneNumber: 1,
    durationSeconds: 6,
    visualDescriptionThai: "ฉากที่ 1",
    imageIndexes: [0],
    transitionIn: "fade",
    assets: [{ assetIndex: 0, kind: "image", motion: "ken_burns_in", durationSeconds: 6 }],
  },
  {
    sceneNumber: 2,
    durationSeconds: 8,
    visualDescriptionThai: "ฉากที่ 2",
    imageIndexes: [1],
    transitionIn: "fade",
    assets: [
      { assetIndex: 1, kind: "image", motion: "pan_left", durationSeconds: 4 },
      { assetIndex: 2, kind: "image", motion: "static", durationSeconds: 4 },
    ],
  },
];

async function createMontageJob(
  requestId: string,
  step: VideoGenerationStep,
  overrides: Record<string, unknown> = {}
) {
  return mockJobRepo.create({
    requestId,
    status: VideoGenerationJobStatus.Active,
    currentStep: step,
    currentSceneIndex: 0,
    // videoEngine intentionally omitted → defaults to montage.
    scenePlan: null,
    scriptThai: "สวัสดีค่ะ",
    scriptEnglish: null,
    scriptChinese: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: JSON.stringify(MONTAGE_PLAN),
    approvedScriptThai: "สวัสดีค่ะ",
    approvedScriptEnglish: null,
    approvedScriptChinese: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: "",
    voiceRecordingAssetId: "voice-asset",
    processedVoiceAssetId: "voice-asset",
    selectedMusicTrack: null,
    voiceDurationSeconds: 14,
    voiceTimestamps: JSON.stringify([{ start: 0, end: 14, text: "สวัสดีค่ะ" }]),
    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: null,
    subtitleTimeline: JSON.stringify([{ start: 0, end: 14, text: "สวัสดีค่ะ" }]),
    animationSpec: null,
    animatedVideoAssetId: null,
    animatedOverlayAssetIds: null,
    subtitleLanguages: ["en", "zh"],
    finalExport_9_16_assetId: null,
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_tvent_assetId: null,
    failedAtStep: null,
    contentApprovedBy: USER_ID,
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,
    ...overrides,
  });
}

describe("VideoGenerationService — montage engine (Phase 3)", () => {
  beforeEach(() => {
    renderSceneCallCount = 0;
    renderSceneMock.mockClear();
    createVideoMock.mockClear();
    extendVideoMock.mockClear();
    concatVideosMock.mockClear();
    generateSceneDesignFromScriptMock.mockClear();
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);
  });

  it("renders EVERY scene segment when the scene design is approved, then advances to the combined review", async () => {
    const request = await createRequestWithImages(3);
    const ordered = orderSourceAssets(await mockAssetRepo.findByRequestId(request.id));
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingSceneDesignApproval);

    const service = new VideoGenerationService();
    await service.approveSceneDesignByRequester(job.id, USER_ID, {
      scenePlan: JSON.stringify(MONTAGE_PLAN),
      durationSeconds: 14,
    });
    await flush();

    expect(createVideoMock).not.toHaveBeenCalled();
    // Batch: both scenes rendered up front.
    expect(renderSceneMock).toHaveBeenCalledTimes(2);

    const [scene0Props] = renderSceneMock.mock.calls[0];
    expect(scene0Props.ratio).toBe("9:16");
    expect(scene0Props.transition).toBe("fade");
    expect(scene0Props.durationSeconds).toBe(6);
    // Index alignment: scene 0 → ordered[0]; scene 1 → ordered[1], ordered[2].
    expect(scene0Props.assets.map((a: any) => a.url)).toEqual([ordered[0].url]);
    expect(scene0Props.assets[0].motion).toBe("ken_burns_in");
    const [scene1Props] = renderSceneMock.mock.calls[1];
    expect(scene1Props.assets.map((a: any) => a.url)).toEqual([ordered[1].url, ordered[2].url]);
    expect(scene1Props.durationSeconds).toBe(8);

    const after = await mockJobRepo.findById(job.id);
    expect(after?.currentStep).toBe(VideoGenerationStep.AwaitingVideoApproval);
    expect(after?.sceneVideoAssetIds?.filter(Boolean)).toHaveLength(2);
    expect(after?.baseVideoAssetId).toBeTruthy();
    expect(after?.videoGenTaskIds).toBeNull();
    expect(concatVideosMock).not.toHaveBeenCalled();
  });

  it("'Approve all' concatenates every scene segment into the base video and starts animation", async () => {
    const request = await createRequestWithImages(3);
    // A real voice asset so the downstream animation step runs cleanly.
    const voiceAsset = await mockAssetRepo.create({
      requestId: request.id,
      userId: USER_ID,
      fileName: "voice.mp3",
      assetType: AssetType.StaffVoiceRecording,
      fileSizeBytes: 1024,
      mimeType: "audio/mpeg",
      storageKey: "voice/voice.mp3",
      storageUrl: "https://cdn.example.com/voice/voice.mp3",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingSceneDesignApproval, {
      voiceRecordingAssetId: voiceAsset.id,
      processedVoiceAssetId: voiceAsset.id,
    });

    const service = new VideoGenerationService();
    await service.approveSceneDesignByRequester(job.id, USER_ID, {
      scenePlan: JSON.stringify(MONTAGE_PLAN),
      durationSeconds: 14,
    });
    await flush();

    const review = await mockJobRepo.findById(job.id);
    expect(review?.currentStep).toBe(VideoGenerationStep.AwaitingVideoApproval);
    expect(review?.sceneVideoAssetIds?.filter(Boolean)).toHaveLength(2);
    expect(concatVideosMock).not.toHaveBeenCalled();

    // Approve all → concat every segment → animation.
    const final = await service.approveBaseVideoByRequester(job.id, USER_ID);
    expect(concatVideosMock).toHaveBeenCalledTimes(1);
    const [concatKeys] = concatVideosMock.mock.calls[0];
    expect(concatKeys).toEqual(["montage/seg-1.mp4", "montage/seg-2.mp4"]);
    expect(final.baseVideoAssetId).toBeTruthy();
    expect(createVideoMock).not.toHaveBeenCalled();

    // The animation step is kicked off fire-and-forget. With subtitles/overlays
    // deferred (Phase 7) it just advances to AwaitingAnimationApproval — assert
    // the settled state rather than the transient GeneratingAnimations (the mock
    // repo mutates the returned job reference in place).
    await flush(); // let the downstream animation step settle
    const settled = await mockJobRepo.findById(job.id);
    expect(settled?.currentStep).toBe(VideoGenerationStep.AwaitingAnimationApproval);
  });

  it("revising one scene re-renders only that scene and keeps the others", async () => {
    const request = await createRequestWithImages(3);
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingSceneDesignApproval);
    const service = new VideoGenerationService();

    await service.approveSceneDesignByRequester(job.id, USER_ID, {
      scenePlan: JSON.stringify(MONTAGE_PLAN),
      durationSeconds: 14,
    });
    await flush();

    const before = await mockJobRepo.findById(job.id);
    expect(before?.sceneVideoAssetIds?.filter(Boolean)).toHaveLength(2);
    const scene0Segment = before!.sceneVideoAssetIds![0];
    const scene1Segment = before!.sceneVideoAssetIds![1];
    renderSceneMock.mockClear();

    // Revise scene index 1 only.
    const revised = await service.requestVideoRevisionByRequester(
      job.id,
      USER_ID,
      { scenePlan: JSON.stringify(MONTAGE_PLAN) },
      1
    );
    expect(revised.currentStep).toBe(VideoGenerationStep.GeneratingBaseVideo);
    expect(revised.currentSceneIndex).toBe(1);
    await flush();

    expect(renderSceneMock).toHaveBeenCalledTimes(1); // only scene 1 re-rendered
    expect(createVideoMock).not.toHaveBeenCalled();
    const after = await mockJobRepo.findById(job.id);
    expect(after?.currentStep).toBe(VideoGenerationStep.AwaitingVideoApproval);
    expect(after?.sceneVideoAssetIds).toHaveLength(2);
    expect(after?.sceneVideoAssetIds![0]).toBe(scene0Segment); // scene 0 untouched
    expect(after?.sceneVideoAssetIds![1]).not.toBe(scene1Segment); // scene 1 replaced
  });

  it("retrying a failed batch re-renders all scenes and returns to the review", async () => {
    const request = await createRequestWithImages(3);
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingSceneDesignApproval);
    const service = new VideoGenerationService();
    // The render failure below is the path under test; capture the error report.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // The first scene render FAILS → the whole batch fails.
    renderSceneMock.mockRejectedValueOnce(new Error("remotion render crashed"));
    await service.approveSceneDesignByRequester(job.id, USER_ID, {
      scenePlan: JSON.stringify(MONTAGE_PLAN),
      durationSeconds: 14,
    });
    await flush();
    const failed = await mockJobRepo.findById(job.id);
    expect(failed?.currentStep).toBe(VideoGenerationStep.Failed);
    expect(failed?.failedAtStep).toBe(VideoGenerationStep.GeneratingBaseVideo);

    renderSceneMock.mockClear();
    // Retry re-renders the whole batch.
    const retried = await service.retryPipeline(job.id);
    expect(retried.currentStep).toBe(VideoGenerationStep.GeneratingBaseVideo);
    await flush();

    expect(renderSceneMock).toHaveBeenCalledTimes(2); // all scenes re-rendered
    expect(createVideoMock).not.toHaveBeenCalled();
    const afterRetry = await mockJobRepo.findById(job.id);
    expect(afterRetry?.currentStep).toBe(VideoGenerationStep.AwaitingVideoApproval);
    expect(afterRetry?.sceneVideoAssetIds?.filter(Boolean)).toHaveLength(2);
    errorSpy.mockRestore();
  });

  it("scene design fixes a concrete, index-aligned assets[] per scene (from a Veo-shaped Vision plan)", async () => {
    const request = await createRequestWithImages(3);
    const ordered = orderSourceAssets(await mockAssetRepo.findByRequestId(request.id));
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      approvedScenePlan: null,
    });

    const service = new VideoGenerationService();
    await service.approveVoiceConversionByRequester(job.id, USER_ID);
    await flush();

    expect(generateSceneDesignFromScriptMock).toHaveBeenCalledTimes(1);
    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingSceneDesignApproval);

    const plan = JSON.parse(updated!.scenePlan!) as ScenePlan[];
    expect(plan).toHaveLength(2);
    for (const scene of plan) {
      expect(Array.isArray(scene.assets)).toBe(true);
      expect(scene.assets!.length).toBeGreaterThan(0);
      for (const a of scene.assets!) {
        expect(a.assetIndex).toBeGreaterThanOrEqual(0);
        expect(a.assetIndex).toBeLessThan(ordered.length);
        expect(typeof a.motion).toBe("string");
        expect(a.durationSeconds).toBeGreaterThan(0);
      }
    }
    // Vision said scene 1 → image 0, scene 2 → image 1; alignment preserved.
    expect(plan[0].assets!.map((a) => a.assetIndex)).toEqual([0]);
    expect(plan[1].assets!.map((a) => a.assetIndex)).toEqual([1]);
    expect(createVideoMock).not.toHaveBeenCalled();
  });

  it("fails clearly (no Veo) when the request has no usable uploaded media", async () => {
    const request = await createRequestWithImages(0); // zero usable assets
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      approvedScenePlan: null,
    });
    // The no-media failure is the path under test; capture the report quietly.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const service = new VideoGenerationService();
    await service.approveVoiceConversionByRequester(job.id, USER_ID);
    await flush();

    const failed = await mockJobRepo.findById(job.id);
    expect(failed?.currentStep).toBe(VideoGenerationStep.Failed);
    expect(failed?.failedAtStep).toBe(VideoGenerationStep.GeneratingSceneDesign);
    // Vision is never asked to design scenes, and Veo is never touched.
    expect(generateSceneDesignFromScriptMock).not.toHaveBeenCalled();
    expect(createVideoMock).not.toHaveBeenCalled();
    // The failure was reported with an actionable NoUsableMediaError.
    expect(errorSpy).toHaveBeenCalledWith(
      "Scene design generation failed:",
      expect.objectContaining({ name: "NoUsableMediaError" })
    );
    errorSpy.mockRestore();
  });

  it("bakes subject-aware focus (Gemini coords) into each image asset's focusX/focusY", async () => {
    const request = await createRequestWithImages(3);
    const job = await createMontageJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      approvedScenePlan: null,
    });

    // bbox centre → focus: x=(200+400)/2/1000=0.3, y=(100+300)/2/1000=0.2.
    detectProductCoordinatesMock.mockResolvedValueOnce([
      { ymin: 100, xmin: 200, ymax: 300, xmax: 400 },
      { ymin: 0, xmin: 0, ymax: 1000, xmax: 1000 },
      { ymin: 500, xmin: 500, ymax: 700, xmax: 900 },
    ]);

    const service = new VideoGenerationService();
    await service.approveVoiceConversionByRequester(job.id, USER_ID);
    await flush();

    const updated = await mockJobRepo.findById(job.id);
    const plan = JSON.parse(updated!.scenePlan!) as ScenePlan[];
    // Scene 1 → image index 0 → coords[0] centre (0.3, 0.2).
    expect(plan[0].assets![0].focusX).toBeCloseTo(0.3, 5);
    expect(plan[0].assets![0].focusY).toBeCloseTo(0.2, 5);
    // Scene 2 → image index 1 → coords[1] centre (0.5, 0.5).
    expect(plan[1].assets![0].focusX).toBeCloseTo(0.5, 5);
    expect(plan[1].assets![0].focusY).toBeCloseTo(0.5, 5);
  });
});
// end of montage Phase 3 suite
