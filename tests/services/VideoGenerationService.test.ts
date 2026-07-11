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
  publishingLinkRepository: new (require("@/repositories/mock/MockPublishingLinkRepository").MockPublishingLinkRepository)(new Map()),
}));

// ── Mock social publishing services (Phase 8 distribution-review) ────────────
const tiktokUploadMock = jest.fn(async () => ({ platformVideoId: "tt1", platformUrl: "https://www.tiktok.com/@x/video/tt1" }));
const youtubeUploadMock = jest.fn(async () => ({ platformVideoId: "yt1", platformUrl: "https://www.youtube.com/watch?v=yt1" }));
const facebookUploadMock = jest.fn(async () => ({ platformVideoId: "fb1", platformUrl: "https://www.facebook.com/x/videos/fb1" }));
const instagramUploadMock = jest.fn(async () => ({ platformVideoId: "ig1", platformUrl: "https://www.instagram.com/p/ig1" }));
jest.mock("@/lib/social/tiktokService", () => ({ uploadVideo: (...a: unknown[]) => tiktokUploadMock(...(a as [])) }));
jest.mock("@/lib/social/youtubeService", () => ({ uploadVideo: (...a: unknown[]) => youtubeUploadMock(...(a as [])) }));
jest.mock("@/lib/social/facebookService", () => ({ uploadVideo: (...a: unknown[]) => facebookUploadMock(...(a as [])) }));
jest.mock("@/lib/social/instagramService", () => ({ uploadVideo: (...a: unknown[]) => instagramUploadMock(...(a as [])) }));

// ── Mock Gemini SDK so publishing-draft generation makes no network call ─────
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: jest.fn(async () => ({ text: "{}" })) },
  })),
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
const applyTiledWatermarkMock = jest.fn(async (params: any) => ({
  storageKey: params.outputStorageKey,
  storageUrl: `https://cdn.example.com/${params.outputStorageKey}`,
  fileSizeBytes: 3072,
}));
jest.mock("@/lib/ai/ffmpegService", () => ({
  concatVideos: (...args: unknown[]) => concatVideosMock(...args),
  getRequiredRatiosForPlatforms: (...args: unknown[]) => getRequiredRatiosForPlatformsMock(...args),
  composeAndExport: (...args: unknown[]) => composeAndExportMock(...args),
  renderOverlayPreview: (...args: unknown[]) => renderOverlayPreviewMock(...args),
  overlayOnMaster: (...args: unknown[]) => overlayOnMasterMock(...args),
  applyTiledWatermark: (...args: unknown[]) => applyTiledWatermarkMock(...args),
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
  // Identity pass-through: mirrors the real function's behaviour for the short
  // segments used in these tests (no long-sentence splitting needed). Without
  // this the overlay path's dynamic import got `undefined` → "not a function".
  splitSegmentsForDisplay: (segments: unknown, _langs: unknown) => segments,
}));

// Mock DO Spaces so the overlay path's `probeAudioDurationSeconds` (a real
// S3 GetObject) never hits the network. Without this it rejects only after the
// AWS SDK's retry/timeout timers, which is non-deterministic and outruns the
// microtask-based `flushBackground()` — leaving the captioned render un-awaited.
// Rejecting instantly makes the caller's catch fire fast so the render proceeds.
jest.mock("@/lib/spaces", () => ({
  spacesClient: { send: jest.fn(async () => { throw new Error("spaces disabled in tests"); }) },
  spacesPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  spacesSignedUrl: async (key: string) => `https://cdn.example.com/signed/${key}`,
  SPACES_BUCKET: "test-bucket",
  SIGNED_URL_TTL_SECONDS: 3600,
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
  publishingLinkRepository: mockPublishingLinkRepo,
} = jest.requireMock("@/repositories/index") as {
  clipRequestRepository: MockClipRequestRepository;
  uploadedAssetRepository: MockUploadedAssetRepository;
  videoGenerationJobRepository: MockVideoGenerationJobRepository;
  videoPublishRecordRepository: MockVideoPublishRecordRepository;
  publishingLinkRepository: import("@/repositories/mock/MockPublishingLinkRepository").MockPublishingLinkRepository;
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

// Drain the fire-and-forget background chains (overlay + Travy render). They
// nest several `await import()` hops plus the mocked render and, crucially, a
// real `fs.mkdtemp`/`fs.rm` inside the duration probe — so a fixed setImmediate
// count races real fs I/O and flakes under parallel load. Instead we poll a
// caller-supplied predicate against a wall-clock deadline, returning as soon as
// the background work is observably done (or after the timeout as a backstop).
const flushBackground = async (
  until?: () => boolean | Promise<boolean>,
  timeoutMs = 5000
) => {
  const deadline = Date.now() + timeoutMs;
  do {
    await new Promise((r) => setTimeout(r, 5));
    if (until && (await until())) return;
  } while (Date.now() < deadline);
};

describe("VideoGenerationService — Phase 7 subtitle/motion overlay", () => {
  beforeEach(() => {
    renderTemplatedVideoMock.mockClear();
    getRequiredRatiosForPlatformsMock.mockReset();
    composeAndExportMock.mockReset();
    overlayOnMasterMock.mockClear();
    applyTiledWatermarkMock.mockClear();
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
    await flushBackground(
      async () =>
        (await mockJobRepo.findById(job.id))?.currentStep ===
        VideoGenerationStep.AwaitingOverlayApproval
    );

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

    // Pay-to-download watermark: the delivered captioned master gets a
    // pre-rendered tiled-watermark sibling, linked back via sourceAssetId, so a
    // locked (unpaid) requester is only ever shown the watermarked variant.
    expect(applyTiledWatermarkMock).toHaveBeenCalledTimes(1);
    const cleanId = updated?.captionedExport_9_16_assetId as string;
    const watermarked = await mockAssetRepo.findWatermarkedPreviewFor(cleanId);
    expect(watermarked).not.toBeNull();
    expect(watermarked?.assetType).toBe(AssetType.WatermarkedPreview);
    expect(watermarked?.videoRatio).toBe("9:16");
    expect(watermarked?.sourceAssetId).toBe(cleanId);
  });

  it("approveOverlayByRequester (single ratio, TH subs) lands on distribution-review, renders Travy EN+ZH in background, NOT yet delivered", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const master = await createMaster(request.id, "9:16");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);

    // TH-only subs → Travy cannot reuse; it renders a separate EN+ZH clip.
    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingOverlayApproval,
      { "9:16": master.id },
      ["th"]
    );
    // The overlay preview was rendered before approval — set it so finalize sees it.
    const captioned = await createMaster(request.id, "9:16");
    await mockJobRepo.update(job.id, { captionedExport_9_16_assetId: captioned.id });

    const service = new VideoGenerationService();
    const afterApprove = await service.approveOverlayByRequester(job.id, "user-001");
    // Phase 8: lands on the distribution-review step, NOT Complete.
    expect(afterApprove.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    // Publishing drafts auto-filled for the user's channel (TikTok; Travy excluded).
    expect(afterApprove.publishingDrafts?.map((d) => d.platform)).toEqual([Platform.TikTok]);

    await flushBackground(
      async () => (await mockJobRepo.findById(job.id))?.tventVideoStatus === "ready"
    );

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    expect(updated?.tventVideoStatus).toBe("ready");
    expect(updated?.finalExport_tvent_assetId).toBeTruthy();

    // NOT delivered until the requester confirms publishing — instead it is
    // ScheduledForPublishing (an active status → shows under "in progress").
    const req = await mockClipRepo.findById(request.id);
    expect(req?.status).toBe(RequestStatus.ScheduledForPublishing);
    expect(req?.status).not.toBe(RequestStatus.Delivered);

    // The Travy render uses EN+ZH regardless of the requester's choice.
    const tventCall = renderTemplatedVideoMock.mock.calls.find(
      ([p]: any[]) => JSON.stringify(p.subtitleLanguages) === JSON.stringify(["en", "zh"])
    );
    expect(tventCall).toBeTruthy();
  });

  it("Travy reuse: when subtitle languages are exactly {en,zh}, reuses the primary captioned export instead of re-rendering", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const master = await createMaster(request.id, "9:16");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);

    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingOverlayApproval,
      { "9:16": master.id },
      ["en", "zh"]
    );
    const captioned = await createMaster(request.id, "9:16");
    await mockJobRepo.update(job.id, { captionedExport_9_16_assetId: captioned.id });

    const service = new VideoGenerationService();
    const updated = await service.approveOverlayByRequester(job.id, "user-001");

    expect(updated.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    // Reused immediately — Travy points at the primary captioned export, ready now.
    expect(updated.tventVideoStatus).toBe("ready");
    expect(updated.finalExport_tvent_assetId).toBe(captioned.id);
    // No separate Travy render was performed.
    expect(renderTemplatedVideoMock).not.toHaveBeenCalled();
  });

  it("approveOverlayByRequester (multi-ratio) gates on AwaitingAdditionalRatios, then lands on distribution-review", async () => {
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
    const captioned = await createMaster(request.id, "9:16");
    await mockJobRepo.update(job.id, { captionedExport_9_16_assetId: captioned.id });

    const service = new VideoGenerationService();
    const gated = await service.approveOverlayByRequester(job.id, "user-001");
    expect(gated.currentStep).toBe(VideoGenerationStep.AwaitingAdditionalRatios);
    expect(gated.finalExport_tvent_assetId).toBeNull();

    await service.generateAdditionalRatiosByRequester(job.id, "user-001");
    await flushBackground(
      async () => (await mockJobRepo.findById(job.id))?.tventVideoStatus === "ready"
    );

    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.captionedExport_16_9_assetId).toBeTruthy();
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    expect(updated?.tventVideoStatus).toBe("ready");
    expect(updated?.finalExport_tvent_assetId).toBeTruthy();
  });

  // ── Render-queue seam: enqueue for a live Mac worker, else run inline ────────
  it("enqueues the overlay render for a live worker instead of rendering inline", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const master = await createMaster(request.id, "9:16");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);
    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingFinalApproval,
      { "9:16": master.id },
      ["th"]
    );

    // A worker heartbeat is fresh → the heavy step must be QUEUED for it, not
    // rendered on the web side. Cleaned up in `finally` so other tests (which
    // rely on the inline fallback) still see no worker.
    await mockJobRepo.recordWorkerHeartbeat("mac-test");
    try {
      const service = new VideoGenerationService();
      await service.approveFinalVideoByRequester(job.id, "user-001", ["th"]);
      // Give any (unexpected) inline render a chance to start before asserting.
      await new Promise((r) => setTimeout(r, 20));

      const updated = await mockJobRepo.findById(job.id);
      expect(updated?.renderState).toBe("queued");
      expect(updated?.renderStep).toBe("overlay_composition");
      expect(updated?.currentStep).toBe(VideoGenerationStep.GeneratingOverlay);
      // The web server did NOT render — that's the worker's job now.
      expect(renderTemplatedVideoMock).not.toHaveBeenCalled();
    } finally {
      (global as { __mockRenderWorkerHeartbeats?: Map<string, number> }).__mockRenderWorkerHeartbeats =
        new Map();
    }
  });

  it("runs the overlay render inline when no worker heartbeat is present (fallback)", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const master = await createMaster(request.id, "9:16");
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);
    const job = await createOverlayJob(
      request.id,
      VideoGenerationStep.AwaitingFinalApproval,
      { "9:16": master.id },
      ["th"]
    );

    const service = new VideoGenerationService();
    await service.approveFinalVideoByRequester(job.id, "user-001", ["th"]);
    await flushBackground(
      async () =>
        (await mockJobRepo.findById(job.id))?.currentStep ===
        VideoGenerationStep.AwaitingOverlayApproval
    );

    const updated = await mockJobRepo.findById(job.id);
    // No worker → ran inline, so it rendered and advanced past GeneratingOverlay.
    expect(updated?.renderState ?? null).not.toBe("queued");
    expect(renderTemplatedVideoMock).toHaveBeenCalled();
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingOverlayApproval);
  });
});

describe("VideoGenerationService — Phase 8 distribution review + publishing", () => {
  beforeEach(() => {
    renderTemplatedVideoMock.mockClear();
    getRequiredRatiosForPlatformsMock.mockReset();
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16"]);
    tiktokUploadMock.mockClear();
    youtubeUploadMock.mockClear();
    facebookUploadMock.mockClear();
    instagramUploadMock.mockClear();
    tiktokUploadMock.mockResolvedValue({ platformVideoId: "tt1", platformUrl: "https://www.tiktok.com/@x/video/tt1" });
    youtubeUploadMock.mockResolvedValue({ platformVideoId: "yt1", platformUrl: "https://www.youtube.com/watch?v=yt1" });
  });

  async function createRequestWithPlatforms(platforms: Platform[]) {
    const request = await mockClipRepo.create({
      userId: "user-001",
      title: "Phase8 Clip",
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

  async function createCaptioned(requestId: string, ratio: string) {
    return mockAssetRepo.create({
      requestId,
      userId: "user-001",
      fileName: `styled_${ratio.replace(":", "-")}.mp4`,
      assetType: AssetType.FinalClip,
      fileSizeBytes: 2048,
      mimeType: "video/mp4",
      storageKey: `styled_exports/${ratio.replace(":", "-")}.mp4`,
      storageUrl: `https://cdn.example.com/styled_${ratio.replace(":", "-")}.mp4`,
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      videoRatio: ratio as any,
    });
  }

  async function createReviewJob(
    requestId: string,
    captioned: Partial<Record<"9:16" | "16:9" | "1:1" | "4:5", string>>,
    drafts: any[]
  ) {
    const job = await mockJobRepo.create({
      requestId,
      status: VideoGenerationJobStatus.Active,
      currentStep: VideoGenerationStep.AwaitingDistributionReview,
      currentSceneIndex: 0,
      scenePlan: null,
      scriptThai: "อร่อยมาก",
      scriptEnglish: "Delicious",
      scriptChinese: "好吃",
      hookThai: "อร่อย",
      hookEnglish: null,
      captionThai: "แคปชั่น",
      captionEnglish: null,
      captionChinese: null,
      approvedScenePlan: JSON.stringify(SCENE_PLAN),
      approvedScriptThai: "อร่อยมาก",
      approvedScriptEnglish: "Delicious",
      approvedScriptChinese: "好吃",
      approvedHookThai: "อร่อย",
      approvedHookEnglish: null,
      approvedCaptionThai: "แคปชั่น",
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
      subtitleLanguages: ["th"],
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
      finalApprovedBy: "user-001",
    });
    await mockJobRepo.update(job.id, {
      captionedExport_9_16_assetId: captioned["9:16"] ?? null,
      captionedExport_16_9_assetId: captioned["16:9"] ?? null,
      captionedExport_1_1_assetId: captioned["1:1"] ?? null,
      captionedExport_4_5_assetId: captioned["4:5"] ?? null,
      publishingDrafts: drafts,
    });
    return (await mockJobRepo.findById(job.id))!;
  }

  it("confirmPublishingByRequester posts every channel, records links, and completes/delivers", async () => {
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.TventApp]);
    const cap = await createCaptioned(request.id, "9:16");
    const drafts = [
      { platform: Platform.TikTok, title: "", caption: "อร่อย", hashtags: ["food"], status: "pending" },
    ];
    const job = await createReviewJob(request.id, { "9:16": cap.id }, drafts);

    const service = new VideoGenerationService();
    const updated = await service.confirmPublishingByRequester(job.id, "user-001", drafts as any);

    expect(tiktokUploadMock).toHaveBeenCalledTimes(1);
    expect(tiktokUploadMock.mock.calls[0][0].videoStorageKey).toBe(cap.storageKey);
    expect(updated.currentStep).toBe(VideoGenerationStep.Complete);
    expect(updated.publishingDrafts?.[0].status).toBe("posted");
    expect(updated.publishingDrafts?.[0].url).toContain("tiktok.com");

    const req = await mockClipRepo.findById(request.id);
    expect(req?.status).toBe(RequestStatus.Delivered);

    const links = await mockPublishingLinkRepo.findByRequestId(request.id);
    expect(links.some((l) => l.platform === Platform.TikTok)).toBe(true);
  });

  it("confirmPublishingByRequester surfaces a missing-ratio export as an error (no fallback) and stays on review", async () => {
    // Instagram needs a 4:5 export; only 9:16 exists → error, no posting attempt.
    const request = await createRequestWithPlatforms([Platform.Instagram, Platform.TventApp]);
    const cap = await createCaptioned(request.id, "9:16");
    const drafts = [
      { platform: Platform.Instagram, title: "", caption: "อร่อย", hashtags: [], status: "pending" },
    ];
    const job = await createReviewJob(request.id, { "9:16": cap.id }, drafts);

    const service = new VideoGenerationService();
    const updated = await service.confirmPublishingByRequester(job.id, "user-001", drafts as any);

    expect(instagramUploadMock).not.toHaveBeenCalled();
    expect(updated.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    expect(updated.publishingDrafts?.[0].status).toBe("failed");
    expect(updated.publishingDrafts?.[0].error).toContain("4:5");
    const req = await mockClipRepo.findById(request.id);
    expect(req?.status).not.toBe(RequestStatus.Delivered);
  });

  it("on partial failure it stays on review; resubmit posts only the failed channel (no double-post)", async () => {
    getRequiredRatiosForPlatformsMock.mockReturnValue(["9:16", "16:9"]);
    const request = await createRequestWithPlatforms([Platform.TikTok, Platform.YouTube, Platform.TventApp]);
    const cap916 = await createCaptioned(request.id, "9:16"); // TikTok
    const cap169 = await createCaptioned(request.id, "16:9"); // YouTube
    const drafts = [
      { platform: Platform.TikTok, title: "", caption: "tt", hashtags: [], status: "pending" },
      { platform: Platform.YouTube, title: "yt", caption: "yt", hashtags: [], status: "pending" },
    ];
    const job = await createReviewJob(request.id, { "9:16": cap916.id, "16:9": cap169.id }, drafts);

    // First attempt: YouTube fails.
    youtubeUploadMock.mockRejectedValueOnce(new Error("YouTube token refresh failed: 401"));

    const service = new VideoGenerationService();
    const first = await service.confirmPublishingByRequester(job.id, "user-001", drafts as any);

    expect(tiktokUploadMock).toHaveBeenCalledTimes(1);
    expect(first.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    const ttDraft1 = first.publishingDrafts?.find((d) => d.platform === Platform.TikTok);
    const ytDraft1 = first.publishingDrafts?.find((d) => d.platform === Platform.YouTube);
    expect(ttDraft1?.status).toBe("posted");
    expect(ytDraft1?.status).toBe("failed");
    expect(ytDraft1?.error).toContain("401");

    // Resubmit: YouTube now succeeds; TikTok must NOT be posted again.
    const second = await service.confirmPublishingByRequester(job.id, "user-001", drafts as any);

    expect(tiktokUploadMock).toHaveBeenCalledTimes(1); // still once — no double-post
    expect(youtubeUploadMock).toHaveBeenCalledTimes(2); // retried
    expect(second.currentStep).toBe(VideoGenerationStep.Complete);
    const req = await mockClipRepo.findById(request.id);
    expect(req?.status).toBe(RequestStatus.Delivered);
  });
});
