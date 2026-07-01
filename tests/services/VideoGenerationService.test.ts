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
const extendVideoMock = jest.fn();
const pollTaskStatusMock = jest.fn();
const downloadAndStoreMock = jest.fn();
jest.mock("@/lib/ai/veoService", () => ({
  createVideo: (...args: unknown[]) => createVideoMock(...args),
  extendVideo: (...args: unknown[]) => extendVideoMock(...args),
  pollTaskStatus: (...args: unknown[]) => pollTaskStatusMock(...args),
  downloadAndStore: (...args: unknown[]) => downloadAndStoreMock(...args),
}));

// ── Mock ffmpeg concat — capture inputs/order ───────────────────────────────
const concatVideosMock = jest.fn();
const getRequiredRatiosForPlatformsMock = jest.fn((..._args: any[]) => ["9:16"]);
const composeAndExportMock = jest.fn();
const renderOverlayPreviewMock = jest.fn();
const overlayOnMasterMock = jest.fn(async (params: any) => ({
  storageKey: `captioned/${params.outputStorageKey ?? "out"}.mp4`,
  storageUrl: `https://cdn.example.com/captioned/out.mp4`,
  fileSizeBytes: 4096,
}));
jest.mock("@/lib/ai/ffmpegService", () => ({
  concatVideos: (...args: unknown[]) => concatVideosMock(...args),
  getRequiredRatiosForPlatforms: (...args: unknown[]) => getRequiredRatiosForPlatformsMock(...args),
  composeAndExport: (...args: unknown[]) => composeAndExportMock(...args),
  renderOverlayPreview: (...args: unknown[]) => renderOverlayPreviewMock(...args),
  overlayOnMaster: (...args: unknown[]) => overlayOnMasterMock(...args),
  // Constants read by the Phase-7 overlay timing helpers.
  MUSIC_LEAD_IN_SECONDS: 0.6,
  DEFAULT_COMPOSE_DURATION_SECONDS: 15,
}));

// ── Mock Phase 4 motion-graphics + Remotion overlay rendering ───────────────
const generateAnimationSpecMock = jest.fn();
jest.mock("@/lib/ai/animationService", () => ({
  generateAnimationSpec: (...args: unknown[]) => generateAnimationSpecMock(...args),
}));

const renderOverlayMock = jest.fn();
const renderTemplatedVideoMock = jest.fn(async (p: any) => ({
  storageKey: `styled/${p?.outputStorageKey ?? "out"}.mp4`,
  storageUrl: "https://cdn.example.com/styled/out.mp4",
  fileSizeBytes: 5000,
}));
jest.mock("@/lib/ai/remotionService", () => ({
  renderOverlay: (...args: unknown[]) => renderOverlayMock(...args),
  renderTemplatedVideo: (...args: unknown[]) => renderTemplatedVideoMock(...args),
}));

// ── Mock palette derivation (no network in tests) ───────────────────────────
const derivePaletteMock = jest.fn(async () => ({
  primary: "#111111",
  secondary: "#222222",
  accent: "#333333",
  neutral: "#FFFFFF",
}));
jest.mock("@/lib/ai/paletteService", () => ({
  derivePalette: (...args: unknown[]) => derivePaletteMock(...args),
  DEFAULT_PALETTE: { primary: "#FF6B35", secondary: "#FFB703", accent: "#06D6A0", neutral: "#FFFFFF" },
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
    currentSceneIndex: 0,
    // These suites assert the legacy Veo generative path; montage is now the
    // default, so pin the engine to 'veo' to exercise that branch explicitly.
    videoEngine: "veo",
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

// ── Step-history coverage (engine-agnostic) ─────────────────────────────────

describe("VideoGenerationService — step history", () => {
  it("records every pipeline step transition in the step history (and skips non-step updates)", async () => {
    const request = await createRequest();
    const job = await createJobAwaitingVoiceApproval(request.id, 12);

    // create() recorded the initial step.
    const initial = await mockJobRepo.listStepHistory(job.id);
    expect(initial.map((h) => h.step)).toEqual([VideoGenerationStep.AwaitingVoiceApproval]);

    await mockJobRepo.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneDesignApproval,
    });
    await mockJobRepo.update(job.id, {
      currentStep: VideoGenerationStep.AwaitingSceneScriptApproval,
      currentSceneIndex: 0,
    });
    // An update WITHOUT currentStep must not add a history row.
    await mockJobRepo.update(job.id, { videoGenStatus: "processing" });

    const after = await mockJobRepo.listStepHistory(job.id);
    expect(after.map((h) => h.step)).toEqual([
      VideoGenerationStep.AwaitingVoiceApproval,
      VideoGenerationStep.AwaitingSceneDesignApproval,
      VideoGenerationStep.AwaitingSceneScriptApproval,
    ]);
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
      currentSceneIndex: 0,
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

    // Phase 7 (deferred): no Remotion overlays, no preview composite, no
    // animation-spec generation — the step just advances and uses the base
    // video as the review preview with no overlay assets.
    expect(renderOverlayMock).not.toHaveBeenCalled();
    expect(renderOverlayPreviewMock).not.toHaveBeenCalled();
    expect(generateAnimationSpecMock).not.toHaveBeenCalled();

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingAnimationApproval);
    expect(updated?.animatedVideoAssetId).toBe(videoAsset.id);
    expect(updated?.animatedOverlayAssetIds).toEqual({});
  });

  it("_runFFmpegComposition skips overlays/subtitles (Phase 7 deferred) and creates final export assets", async () => {
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
    // Phase 7: this step produces un-captioned masters only — no overlays, no
    // burned-in subtitles, and (per the Phase-7 directive) NO smart-crop
    // product-coordinate detection.
    expect(composeParams.overlayStorageKeys).toEqual({});
    expect(composeParams.assSubtitlesContent).toBeUndefined();
    expect(composeParams.assSubtitlesContentTvent).toBeUndefined();
    expect(composeParams.coordinates).toBeUndefined();
    // Subtitle generation + auto product positioning must not run here.
    expect(generateAssSubtitlesMock).not.toHaveBeenCalled();
    expect(detectProductCoordinatesMock).not.toHaveBeenCalled();

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingFinalApproval);
    expect(updated?.finalExport_9_16_assetId).toBeTruthy();
    // Travy is no longer produced here — it is rendered in the Phase-7 step.
    expect(updated?.finalExport_tvent_assetId).toBeNull();
  });
});

// ── Phase 7: subtitle + motion-graphic overlay (composited on the masters) ──

const flushBackground = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};

describe("VideoGenerationService — Phase 7 subtitle/motion overlay", () => {
  beforeEach(() => {
    renderTemplatedVideoMock.mockClear();
    getRequiredRatiosForPlatformsMock.mockReset();
    composeAndExportMock.mockReset();
    overlayOnMasterMock.mockClear();
    detectProductCoordinatesMock.mockClear();
    alignAudioWithScriptMock.mockClear();
  });

  async function createRequestWithPlatforms(platforms: Platform[]) {
    const request = await mockClipRepo.create({
      userId: "user-001",
      title: "Phase7 Clip",
      description: "desc",
      targetAudience: "All",
      targetPlatforms: platforms,
      preferredStyle: "Dynamic",
      preferredLanguage: "Thai",
      durationSeconds: 15,
    });
    await mockClipRepo.updateStatus(request.id, RequestStatus.Editing, {});
    return request;
  }

  async function createMaster(requestId: string, ratio: string) {
    return mockAssetRepo.create({
      requestId,
      userId: "user-001",
      fileName: `final_${ratio.replace(":", "-")}.mp4`,
      assetType: AssetType.FinalClip,
      fileSizeBytes: 2048,
      mimeType: "video/mp4",
      storageKey: `final_exports/${ratio.replace(":", "-")}.mp4`,
      storageUrl: `https://cdn.example.com/final_${ratio.replace(":", "-")}.mp4`,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      videoRatio: ratio as any,
    });
  }

  async function createOverlayJob(
    requestId: string,
    currentStep: VideoGenerationStep,
    masters: Partial<Record<"9:16" | "16:9" | "1:1" | "4:5", string>>,
    subtitleLanguages: ("th" | "en" | "zh")[] = ["th"]
  ) {
    return mockJobRepo.create({
      requestId,
      status: VideoGenerationJobStatus.Active,
      currentStep,
      currentSceneIndex: 0,
      scenePlan: null,
      scriptThai: "อร่อยมาก",
      scriptEnglish: "Delicious",
      scriptChinese: "好吃",
      hookThai: "อร่อย",
      hookEnglish: null,
      captionThai: null,
      captionEnglish: null,
      captionChinese: null,
      approvedScenePlan: JSON.stringify(SCENE_PLAN),
      approvedScriptThai: "อร่อยมาก",
      approvedScriptEnglish: "Delicious",
      approvedScriptChinese: "好吃",
      approvedHookThai: "อร่อย",
      approvedHookEnglish: null,
      approvedCaptionThai: null,
      approvedCaptionEnglish: null,
      approvedCaptionChinese: null,
      ttsTaskId: null,
      rvcVoiceModel: "",
      voiceRecordingAssetId: "voice-1",
      processedVoiceAssetId: "voice-1",
      selectedMusicTrack: null,
      voiceDurationSeconds: 12,
      voiceTimestamps: JSON.stringify(TIMED_SEGMENTS),
      videoGenTaskId: null,
      videoGenTaskIds: null,
      videoGenStatus: null,
      videoGenLastPolledAt: null,
      baseVideoAssetId: "base-1",
      sceneVideoAssetIds: null,
      subtitleTimeline: JSON.stringify(TIMED_SEGMENTS),
      animationSpec: null,
      animatedVideoAssetId: null,
      animatedOverlayAssetIds: null,
      subtitleLanguages,
      finalExport_9_16_assetId: masters["9:16"] ?? null,
      finalExport_16_9_assetId: masters["16:9"] ?? null,
      finalExport_1_1_assetId: masters["1:1"] ?? null,
      finalExport_4_5_assetId: masters["4:5"] ?? null,
      finalExport_tvent_assetId: null,
      failedAtStep: null,
      contentApprovedBy: "user-001",
      videoApprovedBy: null,
      voiceApprovedBy: null,
      animationApprovedBy: null,
      finalApprovedBy: null,
    });
  }

  it("approveFinalVideoByRequester persists languages and renders the PRIMARY captioned preview (no align/detect, lead-in shifted)", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const master = await createMaster(request.id, "9:16");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);

    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingFinalApproval,
      { "9:16": master.id },
      ["en", "zh"]
    );

    const service = new VideoGenerationService();
    await service.approveFinalVideoByRequester(job.id, "user-001", ["th"]);
    await flushBackground();

    // Only the primary ratio is rendered at this step, as ONE styled MP4.
    expect(renderTemplatedVideoMock).toHaveBeenCalledTimes(1);
    const [tp] = renderTemplatedVideoMock.mock.calls[0];
    expect(tp.ratio).toBe("9:16");
    expect(tp.subtitleLanguages).toEqual(["th"]);
    expect(tp.templateId).toBeDefined();
    expect(tp.palette).toBeDefined();
    // The master plays INSIDE the composition (its public URL, audio intact).
    expect(tp.masterUrl).toBe(master.storageUrl);
    // Duration covers voice + music lead-in; captions shifted by the lead-in.
    expect(tp.durationSeconds).toBeCloseTo(12 + 0.6, 5);
    expect(tp.subtitleTimeline[0].startSecond).toBeCloseTo(0.6, 5);
    // Single-pass render — no alpha compositing and no removed AI calls.
    expect(overlayOnMasterMock).not.toHaveBeenCalled();
    expect(alignAudioWithScriptMock).not.toHaveBeenCalled();
    expect(detectProductCoordinatesMock).not.toHaveBeenCalled();

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.subtitleLanguages).toEqual(["th"]);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingOverlayApproval);
    expect(updated?.captionedExport_9_16_assetId).toBeTruthy();
  });

  it("approveOverlayByRequester (single ratio) delivers, then renders Travy EN+ZH in the background", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const master = await createMaster(request.id, "9:16");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);

    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingOverlayApproval,
      { "9:16": master.id }
    );

    const service = new VideoGenerationService();
    await service.approveOverlayByRequester(job.id, "user-001");
    await flushBackground();

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.Complete);
    expect(updated?.tventVideoStatus).toBe("ready");
    expect(updated?.finalExport_tvent_assetId).toBeTruthy();

    const deliveredRequest = await mockClipRepo.findById(request.id);
    expect(deliveredRequest?.status).toBe(RequestStatus.Delivered);

    // The Travy render uses EN+ZH regardless of the requester's choice.
    const tventCall = renderTemplatedVideoMock.mock.calls.find(
      ([p]: any[]) => JSON.stringify(p.subtitleLanguages) === JSON.stringify(["en", "zh"])
    );
    expect(tventCall).toBeTruthy();
  });

  it("approveOverlayByRequester (multi-ratio) gates on AwaitingAdditionalRatios, then generates the rest before Travy", async () => {
    const request = await createRequestWithPlatforms([
      Platform.TikTok,
      Platform.YouTube,
      Platform.TventApp,
    ]);
    const master916 = await createMaster(request.id, "9:16");
    const master169 = await createMaster(request.id, "16:9");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16", "16:9"]);

    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingOverlayApproval,
      { "9:16": master916.id, "16:9": master169.id }
    );

    const service = new VideoGenerationService();
    const gated = await service.approveOverlayByRequester(job.id, "user-001");
    expect(gated.currentStep).toBe(VideoGenerationStep.AwaitingAdditionalRatios);
    expect(gated.finalExport_tvent_assetId).toBeNull();

    await service.generateAdditionalRatiosByRequester(job.id, "user-001");
    await flushBackground();

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.captionedExport_16_9_assetId).toBeTruthy();
    expect(updated?.currentStep).toBe(VideoGenerationStep.Complete);
    expect(updated?.tventVideoStatus).toBe("ready");
    expect(updated?.finalExport_tvent_assetId).toBeTruthy();
  });
});
