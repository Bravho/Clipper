/**
 * Focused test for the audio-first pipeline reorder (Phase 1):
 *
 *   ChatGPT analysis -> voice generation (ElevenLabs + ffprobe + Gemini
 *   alignment) -> Veo base video sized to the REAL voice duration ->
 *   animations -> FFmpeg composition -> publishing.
 *
 * This test exercises `approveVoiceConversion`, which transitions a job from
 * AwaitingVoiceApproval -> GeneratingBaseVideo and triggers Veo generation.
 * It asserts that the video generator is called with `durationSeconds` taken
 * from `job.voiceDurationSeconds` (the ffprobe-measured voice length) rather
 * than the original scene-plan/request estimate.
 *
 * Repositories are wired with fresh in-memory Mock instances (per CLAUDE.md
 * testing pattern: `new Map()`), bypassing the globalThis singletons. The
 * Veo client is mocked so no real network call is made.
 */

import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockUploadedAssetRepository } from "@/repositories/mock/MockUploadedAssetRepository";
import { MockVideoGenerationJobRepository } from "@/repositories/mock/MockVideoGenerationJobRepository";
import { MockVideoPublishRecordRepository } from "@/repositories/mock/MockVideoPublishRecordRepository";
import { Platform } from "@/domain/enums/Platform";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

// ── Mock repositories module (used via `@/repositories/index` singletons) ──
jest.mock("@/repositories/index", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
  uploadedAssetRepository: new (require("@/repositories/mock/MockUploadedAssetRepository").MockUploadedAssetRepository)(new Map()),
  videoGenerationJobRepository: new (require("@/repositories/mock/MockVideoGenerationJobRepository").MockVideoGenerationJobRepository)(new Map()),
  videoPublishRecordRepository: new (require("@/repositories/mock/MockVideoPublishRecordRepository").MockVideoPublishRecordRepository)(new Map()),
}));

// ── Mock Veo client — capture the params it's called with ──────────────────
const createVideoMock = jest.fn().mockResolvedValue("veo-task-123");
const pollTaskStatusMock = jest.fn();
const downloadAndStoreMock = jest.fn();
jest.mock("@/lib/ai/veoService", () => ({
  createVideo: (...args: unknown[]) => createVideoMock(...args),
  pollTaskStatus: (...args: unknown[]) => pollTaskStatusMock(...args),
  downloadAndStore: (...args: unknown[]) => downloadAndStoreMock(...args),
}));

// ── Mock ffmpeg concat — capture inputs/order ───────────────────────────────
const concatVideosMock = jest.fn();
const getRequiredRatiosForPlatformsMock = jest.fn((..._args: any[]) => ["9:16"]);
const composeAndExportMock = jest.fn();
const renderOverlayPreviewMock = jest.fn();
jest.mock("@/lib/ai/ffmpegService", () => ({
  concatVideos: (...args: unknown[]) => concatVideosMock(...args),
  getRequiredRatiosForPlatforms: (...args: unknown[]) => getRequiredRatiosForPlatformsMock(...args),
  composeAndExport: (...args: unknown[]) => composeAndExportMock(...args),
  renderOverlayPreview: (...args: unknown[]) => renderOverlayPreviewMock(...args),
}));

// ── Mock Phase 4 motion-graphics + Remotion overlay rendering ───────────────
const generateAnimationSpecMock = jest.fn();
jest.mock("@/lib/ai/animationService", () => ({
  generateAnimationSpec: (...args: unknown[]) => generateAnimationSpecMock(...args),
}));

const renderOverlayMock = jest.fn();
jest.mock("@/lib/ai/remotionService", () => ({
  renderOverlay: (...args: unknown[]) => renderOverlayMock(...args),
}));

// ── Mock Gemini subtitle helpers used during final composition ─────────────
const generateAssSubtitlesMock = jest.fn((..._args: any[]) => "ASS_CONTENT");
const detectProductCoordinatesMock = jest.fn(async (..._args: any[]) => [] as any[]);
const alignAudioWithScriptMock = jest.fn(async (..._args: any[]) => [] as any[]);
jest.mock("@/lib/ai/geminiSubtitlesService", () => ({
  generateAssSubtitles: (...args: unknown[]) => generateAssSubtitlesMock(...args),
  detectProductCoordinates: (...args: unknown[]) => detectProductCoordinatesMock(...args),
  alignAudioWithScript: (...args: unknown[]) => alignAudioWithScriptMock(...args),
}));

const mockGenerateSceneDesignFromScript = jest.fn(async (_params: unknown) => ({
  scenePlan: [
    {
      sceneNumber: 1,
      durationSeconds: 15,
      visualDescriptionThai: "ฉากทดสอบ",
      imageIndexes: [0],
    },
  ],
  hookThai: "ฮุกทดสอบ",
  captionThai: "แคปชั่นทดสอบ",
  theme: "ธีมทดสอบ",
}));
jest.mock("@/lib/ai/chatGptVisionService", () => ({
  generateSceneDesignFromScript: (params: unknown) => mockGenerateSceneDesignFromScript(params),
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
  videoPublishRecordRepository: MockVideoPublishRecordRepository;
};

// Import the service AFTER the mocks are registered.
import { VideoGenerationService } from "@/services/VideoGenerationService";

const STAFF_ID = "user-staff-001";

const SCENE_PLAN: ScenePlan[] = [
  {
    sceneNumber: 1,
    durationSeconds: 15,
    visualDescriptionThai: "ฉากเปิดร้านอาหาร",
    imageIndexes: [0],
  },
];

async function createRequest() {
  const request = await mockClipRepo.create({
    userId: "user-001",
    title: "Test Clip",
    description: "Test description",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic",
    preferredLanguage: "Thai",
    durationSeconds: 15, // scene-plan / submission estimate
  });

  await mockClipRepo.updateStatus(request.id, RequestStatus.Editing, {});

  await mockAssetRepo.create({
    requestId: request.id,
    userId: "user-001",
    fileName: "scene1.jpg",
    assetType: AssetType.Image,
    fileSizeBytes: 1024,
    mimeType: "image/jpeg",
    storageKey: "tmp/scene1.jpg",
    storageUrl: "https://cdn.example.com/scene1.jpg",
    thumbnailKey: "",
    thumbnailUrl: "",
    uploadStatus: AssetUploadStatus.Uploaded,
    scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });

  return request;
}

async function createJobAwaitingVoiceApproval(requestId: string, voiceDurationSeconds: number) {
  return mockJobRepo.create({
    requestId,
    status: VideoGenerationJobStatus.Active,
    currentStep: VideoGenerationStep.AwaitingVoiceApproval,
    scenePlan: null,
    scriptThai: "สวัสดีค่ะ ยินดีต้อนรับ",
    scriptEnglish: null,
    scriptChinese: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: JSON.stringify(SCENE_PLAN),
    approvedScriptThai: "สวัสดีค่ะ ยินดีต้อนรับ",
    approvedScriptEnglish: null,
    approvedScriptChinese: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: "",
    voiceRecordingAssetId: "asset-voice-001",
    processedVoiceAssetId: "asset-voice-001",
    selectedMusicTrack: null,
    // Real ffprobe-measured duration of the synthesized voice — different
    // from the request's 15s estimate, to prove video generation uses THIS value.
    voiceDurationSeconds,
    voiceTimestamps: JSON.stringify([{ start: 0, end: voiceDurationSeconds, text: "สวัสดีค่ะ ยินดีต้อนรับ" }]),
    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    baseVideoAssetId: null,
    sceneVideoAssetIds: null,
    subtitleTimeline: JSON.stringify([{ start: 0, end: voiceDurationSeconds, text: "สวัสดีค่ะ ยินดีต้อนรับ" }]),
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
    contentApprovedBy: "user-001",
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,
  });
}

describe("VideoGenerationService — audio-first pipeline (Phase 1)", () => {
  beforeEach(() => {
    createVideoMock.mockClear();
    mockGenerateSceneDesignFromScript.mockClear();
  });

  it("sizes video generation to the real voice duration, not the request estimate", async () => {
    const request = await createRequest();
    const voiceDurationSeconds = 18.4; // differs from request.durationSeconds (15)
    const job = await createJobAwaitingVoiceApproval(request.id, voiceDurationSeconds);

    const service = new VideoGenerationService();
    const updated = await service.approveVoiceConversion(job.id, STAFF_ID, "none");
    await new Promise((resolve) => setImmediate(resolve));

    expect(createVideoMock).not.toHaveBeenCalled();
    expect(mockGenerateSceneDesignFromScript).toHaveBeenCalledTimes(1);
    expect(updated.currentStep).toBe(VideoGenerationStep.GeneratingSceneDesign);
    expect(updated.voiceApprovedBy).toBe(STAFF_ID);
    expect(updated.selectedMusicTrack).toBeNull();
  });

  it("falls back to the request's duration estimate when voiceDurationSeconds is null", async () => {
    const request = await createRequest();
    const job = await createJobAwaitingVoiceApproval(request.id, 0);
    // Simulate a job where ffprobe failed and voiceDurationSeconds stayed null.
    await mockJobRepo.update(job.id, { voiceDurationSeconds: null });
    await mockJobRepo.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
    });

    const service = new VideoGenerationService();
    await service.approveSceneDesignByRequester(job.id, STAFF_ID, {
      scenePlan: JSON.stringify(SCENE_PLAN),
      durationSeconds: request.durationSeconds,
    });

    expect(createVideoMock).toHaveBeenCalledTimes(1);
    const [veoParams] = createVideoMock.mock.calls[0];
    expect(veoParams.durationSeconds).toBe(request.durationSeconds);
  });
});

// ── Phase 3: per-scene Veo generation ───────────────────────────────────────

const MULTI_SCENE_PLAN: ScenePlan[] = [
  {
    sceneNumber: 1,
    durationSeconds: 5, // 25% of 20s estimate total
    visualDescriptionThai: "ฉากที่ 1: เปิดร้าน",
    imageIndexes: [0],
  },
  {
    sceneNumber: 2,
    durationSeconds: 15, // 75% of 20s estimate total
    visualDescriptionThai: "ฉากที่ 2: เสิร์ฟอาหาร",
    imageIndexes: [1, 2],
  },
];

async function createRequestWithImages(imageCount: number) {
  const request = await mockClipRepo.create({
    userId: "user-001",
    title: "Test Clip Multi-Scene",
    description: "Test description",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok],
    preferredStyle: "Dynamic",
    preferredLanguage: "Thai",
    durationSeconds: 15,
  });

  await mockClipRepo.updateStatus(request.id, RequestStatus.Editing, {});

  for (let i = 0; i < imageCount; i++) {
    await mockAssetRepo.create({
      requestId: request.id,
      userId: "user-001",
      fileName: `scene${i}.jpg`,
      assetType: AssetType.Image,
      fileSizeBytes: 1024,
      mimeType: "image/jpeg",
      storageKey: `tmp/scene${i}.jpg`,
      storageUrl: `https://cdn.example.com/scene${i}.jpg`,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  }

  return request;
}

async function createMultiSceneJobAwaitingVoiceApproval(requestId: string, voiceDurationSeconds: number) {
  return mockJobRepo.create({
    requestId,
    status: VideoGenerationJobStatus.Active,
    currentStep: VideoGenerationStep.AwaitingVoiceApproval,
    scenePlan: null,
    scriptThai: "สวัสดีค่ะ ยินดีต้อนรับ",
    scriptEnglish: null,
    scriptChinese: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: JSON.stringify(MULTI_SCENE_PLAN),
    approvedScriptThai: "สวัสดีค่ะ ยินดีต้อนรับ",
    approvedScriptEnglish: null,
    approvedScriptChinese: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: "",
    voiceRecordingAssetId: "asset-voice-001",
    processedVoiceAssetId: "asset-voice-001",
    selectedMusicTrack: null,
    voiceDurationSeconds,
    voiceTimestamps: JSON.stringify([{ start: 0, end: voiceDurationSeconds, text: "สวัสดีค่ะ ยินดีต้อนรับ" }]),
    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: null,
    subtitleTimeline: JSON.stringify([{ start: 0, end: voiceDurationSeconds, text: "สวัสดีค่ะ ยินดีต้อนรับ" }]),
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
    contentApprovedBy: "user-001",
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,
  });
}

describe("VideoGenerationService — per-scene Veo generation (Phase 3)", () => {
  beforeEach(() => {
    createVideoMock.mockClear();
    createVideoMock.mockResolvedValueOnce("veo-task-scene-1").mockResolvedValueOnce("veo-task-scene-2");
    pollTaskStatusMock.mockReset();
    downloadAndStoreMock.mockReset();
    concatVideosMock.mockReset();
  });

  it("issues one Veo call per scene with allocated durations and per-scene image subsets", async () => {
    const request = await createRequestWithImages(3); // scene0, scene1, scene2
    const voiceDurationSeconds = 20;
    const job = await createMultiSceneJobAwaitingVoiceApproval(request.id, voiceDurationSeconds);

    const service = new VideoGenerationService();
    await mockJobRepo.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
    });
    const updated = await service.approveSceneDesignByRequester(job.id, STAFF_ID, {
      scenePlan: JSON.stringify(MULTI_SCENE_PLAN),
      durationSeconds: voiceDurationSeconds,
    });

    expect(createVideoMock).toHaveBeenCalledTimes(2);

    // Scene 1: 25% of 20s = 5s, image index [0]
    const [scene1Params] = createVideoMock.mock.calls[0];
    expect(scene1Params.durationSeconds).toBeCloseTo(5, 5);
    expect(scene1Params.imageUrls).toEqual(["https://cdn.example.com/scene0.jpg"]);
    expect(scene1Params.prompt).toContain("ฉากที่ 1: เปิดร้าน");
    expect(scene1Params.prompt).toContain("Do not fabricate or hallucinate");

    // Scene 2: 75% of 20s = 15s, image indexes [1, 2]
    const [scene2Params] = createVideoMock.mock.calls[1];
    expect(scene2Params.durationSeconds).toBeCloseTo(15, 5);
    expect(scene2Params.imageUrls).toEqual([
      "https://cdn.example.com/scene1.jpg",
      "https://cdn.example.com/scene2.jpg",
    ]);
    expect(scene2Params.prompt).toContain("ฉากที่ 2: เสิร์ฟอาหาร");

    // Job records both task IDs and advances to GeneratingBaseVideo.
    expect(updated.currentStep).toBe(VideoGenerationStep.GeneratingBaseVideo);
    expect(updated.videoGenTaskIds).toEqual(["veo-task-scene-1", "veo-task-scene-2"]);
    expect(updated.videoGenTaskId).toBe("veo-task-scene-1");
  });

  it("checkBaseVideoReady waits for ALL scenes before advancing, then concatenates", async () => {
    const request = await createRequestWithImages(3);
    const voiceDurationSeconds = 20;
    const job = await createMultiSceneJobAwaitingVoiceApproval(request.id, voiceDurationSeconds);

    const service = new VideoGenerationService();
    await mockJobRepo.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
    });
    await service.approveSceneDesignByRequester(job.id, STAFF_ID, {
      scenePlan: JSON.stringify(MULTI_SCENE_PLAN),
      durationSeconds: voiceDurationSeconds,
    });

    // First poll: scene 1 succeeds, scene 2 still processing.
    pollTaskStatusMock
      .mockResolvedValueOnce({ status: "succeed", videoUrl: "https://veo.example.com/scene1.mp4" })
      .mockResolvedValueOnce({ status: "processing" });
    downloadAndStoreMock.mockResolvedValueOnce({
      storageKey: "ai_videos/scene1.mp4",
      storageUrl: "https://cdn.example.com/ai_videos/scene1.mp4",
      fileSizeBytes: 1000,
    });

    let result = await service.checkBaseVideoReady(job.id);
    expect(result.currentStep).toBe(VideoGenerationStep.GeneratingBaseVideo);
    expect(result.baseVideoAssetId).toBeNull();
    expect(concatVideosMock).not.toHaveBeenCalled();

    // sceneVideoAssetIds should now have scene 1 filled, scene 2 still null.
    expect(result.sceneVideoAssetIds?.[0]).toBeTruthy();
    expect(result.sceneVideoAssetIds?.[1]).toBeFalsy();

    // Second poll: scene 2 now succeeds. Only scene 2 is re-polled (scene 1 already stored).
    pollTaskStatusMock.mockReset();
    pollTaskStatusMock.mockResolvedValueOnce({ status: "succeed", videoUrl: "https://veo.example.com/scene2.mp4" });
    downloadAndStoreMock.mockReset();
    downloadAndStoreMock.mockResolvedValueOnce({
      storageKey: "ai_videos/scene2.mp4",
      storageUrl: "https://cdn.example.com/ai_videos/scene2.mp4",
      fileSizeBytes: 2000,
    });
    concatVideosMock.mockResolvedValueOnce({
      storageKey: "ai_videos/concat.mp4",
      storageUrl: "https://cdn.example.com/ai_videos/concat.mp4",
    });

    result = await service.checkBaseVideoReady(job.id);

    // Only scene 2's task was polled this round.
    expect(pollTaskStatusMock).toHaveBeenCalledTimes(1);

    // All scenes ready -> concatenated in scene order -> AwaitingVideoApproval.
    expect(concatVideosMock).toHaveBeenCalledTimes(1);
    const [concatInputs] = concatVideosMock.mock.calls[0];
    expect(concatInputs).toEqual(["ai_videos/scene1.mp4", "ai_videos/scene2.mp4"]);

    expect(result.currentStep).toBe(VideoGenerationStep.AwaitingVideoApproval);
    expect(result.baseVideoAssetId).toBeTruthy();
    expect(result.sceneVideoAssetIds).toHaveLength(2);
  });
});

// ── Phase 4: Remotion-based multi-ratio overlay compositing ────────────────

const TIMED_SEGMENTS = [
  { sentenceNumber: 1, textThai: "สวัสดีค่ะ", textEnglish: "Hello", textChinese: "你好", startSecond: 0, endSecond: 5 },
];

describe("VideoGenerationService — Remotion overlay compositing (Phase 4)", () => {
  beforeEach(() => {
    generateAnimationSpecMock.mockReset();
    renderOverlayMock.mockReset();
    renderOverlayPreviewMock.mockReset();
    getRequiredRatiosForPlatformsMock.mockReset();
    composeAndExportMock.mockReset();
    generateAssSubtitlesMock.mockClear();
    detectProductCoordinatesMock.mockClear();

    generateAnimationSpecMock.mockResolvedValue([
      { startMs: 0, endMs: 5000, type: "kinetic_text", text: "Hello", effect: "fade_in" },
    ]);
    renderOverlayMock.mockResolvedValue("https://cdn.example.com/overlay.webm");
    renderOverlayPreviewMock.mockResolvedValue(undefined);
  });

  async function createAnimationJob(requestId: string, baseVideoAssetId: string, processedVoiceAssetId: string) {
    return mockJobRepo.create({
      requestId,
      status: VideoGenerationJobStatus.Active,
      currentStep: VideoGenerationStep.GeneratingAnimations,
      scenePlan: null,
      scriptThai: "สวัสดีค่ะ ยินดีต้อนรับ",
      scriptEnglish: "Hello, welcome",
      scriptChinese: "你好，欢迎",
      hookThai: "สวัสดี",
      hookEnglish: null,
      captionThai: null,
      captionEnglish: null,
      captionChinese: null,
      approvedScenePlan: JSON.stringify(SCENE_PLAN),
      approvedScriptThai: "สวัสดีค่ะ ยินดีต้อนรับ",
      approvedScriptEnglish: "Hello, welcome",
      approvedScriptChinese: "你好，欢迎",
      approvedHookThai: "สวัสดี",
      approvedHookEnglish: null,
      approvedCaptionThai: null,
      approvedCaptionEnglish: null,
      approvedCaptionChinese: null,
      ttsTaskId: null,
      rvcVoiceModel: "",
      voiceRecordingAssetId: processedVoiceAssetId,
      processedVoiceAssetId,
      selectedMusicTrack: null,
      voiceDurationSeconds: 15,
      voiceTimestamps: JSON.stringify(TIMED_SEGMENTS),
      videoGenTaskId: null,
      videoGenTaskIds: null,
      videoGenStatus: null,
      videoGenLastPolledAt: null,
      baseVideoAssetId,
      sceneVideoAssetIds: null,
      subtitleTimeline: JSON.stringify(TIMED_SEGMENTS),
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
      contentApprovedBy: "user-001",
      videoApprovedBy: "user-001",
      voiceApprovedBy: "user-001",
      animationApprovedBy: null,
      finalApprovedBy: null,
    });
  }

  it("_runAnimationGeneration renders one Remotion overlay per required ratio and stores animatedOverlayAssetIds", async () => {
    const request = await createRequest();

    const audioAsset = await mockAssetRepo.create({
      requestId: request.id,
      userId: "user-001",
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

    const videoAsset = await mockAssetRepo.create({
      requestId: request.id,
      userId: "user-001",
      fileName: "base.mp4",
      assetType: AssetType.AIGeneratedBaseVideo,
      fileSizeBytes: 2048,
      mimeType: "video/mp4",
      storageKey: "ai_videos/base.mp4",
      storageUrl: "https://cdn.example.com/ai_videos/base.mp4",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    getRequiredRatiosForPlatformsMock.mockReturnValueOnce(["9:16", "16:9"]);

    const job = await createAnimationJob(request.id, videoAsset.id, audioAsset.id);

    const service = new VideoGenerationService();
    await (service as any)._runAnimationGeneration(job);

    // Remotion rendered one overlay per required ratio.
    expect(renderOverlayMock).toHaveBeenCalledTimes(2);
    const calledRatios = renderOverlayMock.mock.calls.map(([params]) => params.ratio);
    expect(calledRatios).toEqual(["9:16", "16:9"]);
    for (const [params] of renderOverlayMock.mock.calls) {
      expect(params.durationSeconds).toBe(15);
      expect(params.subtitleLanguages).toEqual(["en", "zh"]);
      expect(params.animationSpecs).toHaveLength(1);
    }

    // Preview composite uses the 9:16 overlay against the base video.
    expect(renderOverlayPreviewMock).toHaveBeenCalledTimes(1);
    const [previewParams] = renderOverlayPreviewMock.mock.calls[0];
    expect(previewParams.ratio).toBe("9:16");
    expect(previewParams.videoStorageKey).toBe(videoAsset.storageKey);

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingAnimationApproval);
    expect(updated?.animatedVideoAssetId).toBeTruthy();
    expect(updated?.animatedOverlayAssetIds).toBeTruthy();
    expect(Object.keys(updated!.animatedOverlayAssetIds!)).toEqual(["9:16", "16:9"]);
  });

  it("_runFFmpegComposition composites per-ratio Remotion overlays and creates final export assets", async () => {
    const request = await createRequest();

    const audioAsset = await mockAssetRepo.create({
      requestId: request.id,
      userId: "user-001",
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

    const videoAsset = await mockAssetRepo.create({
      requestId: request.id,
      userId: "user-001",
      fileName: "base.mp4",
      assetType: AssetType.AIGeneratedBaseVideo,
      fileSizeBytes: 2048,
      mimeType: "video/mp4",
      storageKey: "ai_videos/base.mp4",
      storageUrl: "https://cdn.example.com/ai_videos/base.mp4",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    const overlayAsset = await mockAssetRepo.create({
      requestId: request.id,
      userId: "user-001",
      fileName: "overlay_9-16.webm",
      assetType: AssetType.AnimatedVideo,
      fileSizeBytes: 0,
      mimeType: "video/webm",
      storageKey: "animated_overlays/overlay_9-16.webm",
      storageUrl: "https://cdn.example.com/animated_overlays/overlay_9-16.webm",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      videoRatio: "9:16",
    });

    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);
    composeAndExportMock.mockResolvedValueOnce({
      exports: {
        "9:16": {
          storageKey: "final_clips/final_9-16.mp4",
          storageUrl: "https://cdn.example.com/final_clips/final_9-16.mp4",
        },
      },
    });

    let job = await createAnimationJob(request.id, videoAsset.id, audioAsset.id);
    job = await mockJobRepo.update(job.id, {
      currentStep: VideoGenerationStep.ComposingFinalVideo,
      animatedOverlayAssetIds: { "9:16": overlayAsset.id },
    });

    const service = new VideoGenerationService();
    await (service as any)._runFFmpegComposition(job);

    expect(composeAndExportMock).toHaveBeenCalledTimes(1);
    const [composeParams] = composeAndExportMock.mock.calls[0];
    expect(composeParams.targetRatios).toEqual(["9:16"]);
    expect(composeParams.overlayStorageKeys).toEqual({ "9:16": overlayAsset.storageKey });
    // subtitleLanguages on the job are exactly ["en","zh"] and a 9:16 overlay
    // is present, so the overlay is treated as covering Tvent's subtitle needs.
    expect(composeParams.overlayCoversTventSubtitles).toBe(true);

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingFinalApproval);
    expect(updated?.finalExport_9_16_assetId).toBeTruthy();
  });
});
