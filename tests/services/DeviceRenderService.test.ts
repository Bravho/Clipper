/**
 * The render contract, the job completion, and the failure recovery — the three
 * things a phone renderer can get wrong in a way that costs a requester their
 * video.
 *
 * What is exercised here:
 *   - a device only ever claims its OWN queued, device-eligible step, and a
 *     worker claim always wins the race;
 *   - a refused claim leaves the task queued, so the Mac Mini worker takes it;
 *   - a completion is checked against what was handed out — job, step, stage,
 *     ratio, manifest version, upload key — and against the bytes that landed;
 *   - a SILENT export is refused, which is the specific failure the draft
 *     renderer kept producing;
 *   - completing twice returns the FIRST result and creates one asset, not two;
 *   - an attempt whose lease lapsed cannot overwrite a later worker result.
 *
 * Fresh Mock repos via `new Map()` per CLAUDE.md.
 */

import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockUploadedAssetRepository } from "@/repositories/mock/MockUploadedAssetRepository";
import { MockVideoGenerationJobRepository } from "@/repositories/mock/MockVideoGenerationJobRepository";
import { MockRenderTaskRepository } from "@/repositories/mock/MockRenderTaskRepository";
import { MockDeviceRenderAttemptRepository } from "@/repositories/mock/MockDeviceRenderAttemptRepository";
import { Platform } from "@/domain/enums/Platform";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { RenderStep } from "@/domain/enums/RenderStep";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import type { DeviceRenderCapabilities } from "@/lib/mobile/deviceRenderEligibility";

jest.mock("@/repositories/index", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
  uploadedAssetRepository: new (require("@/repositories/mock/MockUploadedAssetRepository").MockUploadedAssetRepository)(new Map()),
  videoGenerationJobRepository: new (require("@/repositories/mock/MockVideoGenerationJobRepository").MockVideoGenerationJobRepository)(new Map()),
  renderTaskRepository: new (require("@/repositories/mock/MockRenderTaskRepository").MockRenderTaskRepository)(new Map()),
  deviceRenderAttemptRepository: new (require("@/repositories/mock/MockDeviceRenderAttemptRepository").MockDeviceRenderAttemptRepository)(new Map()),
}));

// Phone rendering ships dark; these tests are about what happens once it is on.
jest.mock("@/config/deviceRender", () => {
  const { RenderStep: Step } = require("@/domain/enums/RenderStep");
  return {
    DEVICE_RENDER: {
      enabled: true,
      leaseSeconds: 600,
      heartbeatSeconds: 20,
      resumeAfterSeconds: 60,
      maxOutputBytes: 400 * 1024 * 1024,
      maxCoverBytes: 4 * 1024 * 1024,
      eligibleSteps: [Step.OverlayComposition],
      validation: {
        durationToleranceSeconds: 1.5,
        minOutputBytes: 64 * 1024,
        requireAudioForFinal: true,
      },
    },
    isDeviceEligibleStep: (step: string) => step === Step.OverlayComposition,
  };
});

// ── Storage and media inspection are the two things this service checks the
//    uploaded bytes with; both are stubbed so the suite needs neither a bucket
//    nor ffmpeg, and each test says what the object "is". ───────────────────
let headObjectResult: { ContentLength?: number } | Error = { ContentLength: 8_000_000 };
jest.mock("@/lib/spaces", () => ({
  spacesClient: {
    send: jest.fn(async () => {
      if (headObjectResult instanceof Error) throw headObjectResult;
      return headObjectResult;
    }),
  },
  SPACES_BUCKET: "test-bucket",
  spacesPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  spacesSignedUrl: jest.fn(async (key: string) => `https://signed.example.com/${key}`),
}));

// Annotated rather than inferred: `probeMediaSummary` returns nullable codec
// and dimension fields, and a fixture narrowed to `string` cannot express the
// silent-export case these tests exist to cover.
let mediaSummary: {
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  rotation?: number;
  displayWidth?: number | null;
  displayHeight?: number | null;
} = {
  durationSeconds: 15.2,
  hasVideo: true,
  hasAudio: true,
  videoCodec: "h264",
  audioCodec: "aac",
  width: 1080,
  height: 1920,
};
jest.mock("@/lib/ai/ffmpegService", () => ({
  probeMediaSummary: jest.fn(async () => mediaSummary),
}));

const ensureAssetPoster = jest.fn(async () => null);
jest.mock("@/services/AssetPosterService", () => ({
  ensureAssetPoster: (...args: unknown[]) => ensureAssetPoster(...(args as [])),
}));

const applyDeviceRenderResult = jest.fn(async () => ({ nextStep: "awaiting_overlay_approval" }));
const afterRenderStepCompleted = jest.fn(async () => undefined);
jest.mock("@/services/VideoGenerationService", () => ({
  videoGenerationService: {
    applyDeviceRenderResult: (...args: unknown[]) => applyDeviceRenderResult(...(args as [])),
    afterRenderStepCompleted: (...args: unknown[]) => afterRenderStepCompleted(...(args as [])),
    deriveOverlayPaletteForJob: async () => ({
      primary: "#FF6B35",
      secondary: "#FFB703",
      accent: "#06D6A0",
      neutral: "#FFFFFF",
    }),
  },
}));

jest.mock("@/lib/ai/paletteService", () => ({
  derivePalette: jest.fn(async () => ({
    primary: "#FF6B35",
    secondary: "#FFB703",
    accent: "#06D6A0",
    neutral: "#FFFFFF",
  })),
  DEFAULT_PALETTE: {
    primary: "#FF6B35",
    secondary: "#FFB703",
    accent: "#06D6A0",
    neutral: "#FFFFFF",
  },
}));

jest.mock("@/lib/ai/geminiSubtitlesService", () => ({
  splitSegmentsForDisplay: (segments: unknown[]) => segments,
}));

const {
  clipRequestRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
  renderTaskRepository,
  deviceRenderAttemptRepository,
} = require("@/repositories/index") as {
  clipRequestRepository: MockClipRequestRepository;
  uploadedAssetRepository: MockUploadedAssetRepository;
  videoGenerationJobRepository: MockVideoGenerationJobRepository;
  renderTaskRepository: MockRenderTaskRepository;
  deviceRenderAttemptRepository: MockDeviceRenderAttemptRepository;
};

import { DeviceRenderService, DeviceRenderError, stageForTask } from "@/services/DeviceRenderService";

const OWNER = "user-1";
const OTHER = "user-2";

const capabilities: DeviceRenderCapabilities = {
  platform: "android",
  nativePluginVersion: 5,
  freeBytes: 8_000_000_000,
  supportsH264Encode: true,
  supportsAacEncode: true,
  appInForeground: true,
  lowPowerMode: false,
};

async function seed(options: { withMaster?: boolean } = {}) {
  const request = await clipRequestRepository.create({
    userId: OWNER,
    placeName: "Test Kitchen",
    briefText: "A short promo",
    targetPlatforms: [Platform.TikTok],
    durationSeconds: 15,
    status: RequestStatus.AcceptedForProduction,
  } as never);

  let masterAssetId: string | null = null;
  if (options.withMaster !== false) {
    const master = await uploadedAssetRepository.create({
      requestId: request.id,
      userId: OWNER,
      fileName: "final_9-16.mp4",
      assetType: AssetType.FinalClip,
      fileSizeBytes: 40_000_000,
      mimeType: "video/mp4",
      storageKey: "final_exports/user-1/2026-01-01/r/9-16/master.mp4",
      storageUrl: "https://cdn.example.com/master.mp4",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Uploaded,
      scheduledDeletionAt: new Date("2030-01-01"),
      videoRatio: "9:16",
    } as never);
    masterAssetId = master.id;
  }

  const job = await videoGenerationJobRepository.create({
    requestId: request.id,
    status: VideoGenerationJobStatus.Active,
    currentStep: VideoGenerationStep.GeneratingOverlay,
    currentSceneIndex: 0,
    scenePlan: null,
    scriptThai: null,
    scriptEnglish: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: null,
    approvedScriptThai: "สคริปต์",
    approvedScriptEnglish: "script",
    approvedHookThai: "hook",
    approvedHookEnglish: "hook",
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: "voice-1",
    voiceRecordingAssetId: null,
    processedVoiceAssetId: null,
    selectedMusicTrack: "happy",
    voiceDurationSeconds: 14,
    voiceTimestamps: null,
    videoGenTaskIds: null,
    videoGenTaskId: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: null,
    subtitleTimeline: JSON.stringify([
      { sentenceNumber: 1, textThai: "สวัสดี", textEnglish: "Hello", startSecond: 0, endSecond: 2 },
    ]),
    animationSpec: null,
    animatedVideoAssetId: null,
    animatedOverlayAssetIds: null,
    subtitleLanguages: ["th", "en"],
    finalExport_9_16_assetId: masterAssetId,
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_travy_assetId: null,
    failedAtStep: null,
    contentApprovedBy: null,
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,
  } as never);

  const task = await renderTaskRepository.enqueue({
    jobId: job.id,
    requestId: request.id,
    requesterId: OWNER,
    step: RenderStep.OverlayComposition,
  });

  return { request, job, task, masterAssetId };
}

function completion(
  attemptId: string,
  jobId: string,
  storageKey: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    attemptId,
    userId: OWNER,
    jobId,
    step: RenderStep.OverlayComposition,
    stage: "final" as const,
    ratio: "9:16" as const,
    manifestVersion: 4,
    storageKey,
    coverStorageKey: null,
    fileSizeBytes: 8_000_000,
    durationSeconds: 15.2,
    width: 1080,
    height: 1920,
    hasAudioTrack: true,
    ...overrides,
  };
}

describe("DeviceRenderService", () => {
  let service: DeviceRenderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // The mocked registry is a module singleton, so every test in this file
    // shares one queue. Draining it keeps `claimNext` in one test from picking
    // up the task another test seeded — which is a property of the real FIFO
    // line, and not the thing these tests are about.
    for (const task of await renderTaskRepository.listActive()) {
      await renderTaskRepository.complete(task.id, "done");
    }
    headObjectResult = { ContentLength: 8_000_000 };
    mediaSummary = {
      durationSeconds: 15.2,
      hasVideo: true,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1080,
      height: 1920,
    };
    applyDeviceRenderResult.mockResolvedValue({ nextStep: "awaiting_overlay_approval" });
    service = new DeviceRenderService();
  });

  // ── claiming ─────────────────────────────────────────────────────────────

  describe("claiming a queued step", () => {
    it("hands the owner a validated manifest for the step that is waiting", async () => {
      const { request, job, task } = await seed();

      const result = await service.claim({
        requestId: request.id,
        userId: OWNER,
        capabilities,
      });

      expect("claimed" in result).toBe(false);
      if ("claimed" in result) return;

      expect(result.manifest.jobId).toBe(job.id);
      expect(result.manifest.stage).toBe("final");
      expect(result.manifest.ratio).toBe("9:16");
      expect(result.manifest.step).toBe(RenderStep.OverlayComposition);
      expect(result.manifest.masterUrl).toContain("signed.example.com");
      // Captions come from the job's approved timeline, shifted by the lead-in
      // because the master opens on music.
      expect(result.manifest.captions.length).toBeGreaterThan(0);
      expect(result.manifest.captions[0].startSeconds).toBeCloseTo(0.6, 5);
      expect(result.manifest.captionLanguages).toEqual(["th", "en"]);
      // The upload key is minted at completion time, not chosen by the device.
      expect(result.manifest.upload).toBeNull();

      const claimed = await renderTaskRepository.findActiveByJob(job.id);
      expect(claimed?.state).toBe("claimed");
      expect(claimed?.claimedBy).toBe(result.attemptId);
      expect(claimed?.id).toBe(task.id);
    });

    it("refuses another requester's work without saying whether it exists", async () => {
      const { request } = await seed();
      await expect(
        service.claim({ requestId: request.id, userId: OTHER, capabilities })
      ).rejects.toMatchObject({ status: 404 });
    });

    it("leaves the task queued when the phone is not up to it", async () => {
      const { request, job } = await seed();

      const result = await service.claim({
        requestId: request.id,
        userId: OWNER,
        capabilities: { ...capabilities, freeBytes: 10_000 },
      });

      expect(result).toEqual({ claimed: false, reason: "insufficient_storage" });
      // The whole point of a refusal: the Mac Mini worker still has the job.
      const task = await renderTaskRepository.findActiveByJob(job.id);
      expect(task?.state).toBe("queued");
      expect(task?.claimedBy).toBeNull();
    });

    it("refuses a step that is not device-eligible", async () => {
      const { request, job } = await seed();
      const active = await renderTaskRepository.findActiveByJob(job.id);
      await renderTaskRepository.complete(active!.id, "done");
      await renderTaskRepository.enqueue({
        jobId: job.id,
        requestId: request.id,
        requesterId: OWNER,
        step: RenderStep.FfmpegComposition,
      });

      const result = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
      expect(result).toEqual({ claimed: false, reason: "step_runs_on_server" });
    });

    it("refuses when the worker already holds the task", async () => {
      const { request } = await seed();
      await renderTaskRepository.claimNext("mac-worker", 120);

      const result = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
      expect(result).toEqual({ claimed: false, reason: "already_rendering" });
    });

    it("refuses without composing a missing master, leaving that to the worker", async () => {
      // `_renderCaptionedRatio` self-heals a missing master by composing it on
      // demand. A phone cannot, so the step has to go back to the worker rather
      // than the phone rendering from nothing.
      const { request, job } = await seed({ withMaster: false });

      const result = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
      expect(result).toEqual({ claimed: false, reason: "inputs_unavailable" });

      const task = await renderTaskRepository.findActiveByJob(job.id);
      expect(task?.state).toBe("queued");
    });

    it("composes a phone-only final from the originals for a build that can", async () => {
      // A studio request: nothing but the phone holds the footage, so a v6+
      // build renders the delivered video from the originals in one encode —
      // no downloaded master, the mix and the template done on the phone.
      const { request, job } = await seed({ withMaster: false });
      const photo = await uploadedAssetRepository.create({
        requestId: request.id,
        userId: OWNER,
        fileName: "photo.jpg",
        assetType: AssetType.Image,
        fileSizeBytes: 1_000_000,
        mimeType: "image/jpeg",
        storageKey: "request_mat/photo.jpg",
        storageUrl: "https://cdn.example.com/photo.jpg",
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt: new Date("2030-01-01"),
      } as never);
      const voice = await uploadedAssetRepository.create({
        requestId: request.id,
        userId: OWNER,
        fileName: "voice.mp3",
        assetType: AssetType.StaffVoiceRecording,
        fileSizeBytes: 200_000,
        mimeType: "audio/mpeg",
        storageKey: "voice/voice.mp3",
        storageUrl: "https://cdn.example.com/voice.mp3",
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt: new Date("2030-01-01"),
      } as never);
      await videoGenerationJobRepository.update(job.id, {
        processedVoiceAssetId: voice.id,
        selectedMotionTemplate: "framed_cream",
        approvedScenePlan: JSON.stringify([
          {
            sceneNumber: 1,
            durationSeconds: 16,
            visualDescriptionThai: "ฉาก",
            imageIndexes: [0],
            transitionIn: "fade",
            assets: [{ assetIndex: 0, kind: "image", motion: "ken_burns_in", durationSeconds: 16 }],
          },
        ]),
      } as never);
      const queued = await renderTaskRepository.findActiveByJob(job.id);
      await renderTaskRepository.complete(queued!.id, "done");
      await renderTaskRepository.enqueue({
        jobId: job.id,
        requestId: request.id,
        requesterId: OWNER,
        step: RenderStep.OverlayComposition,
        deviceOnly: true,
      } as never);

      // The music bed is a public app asset, addressed from the app origin.
      process.env.NEXTAUTH_URL = "https://app.example.com";

      // A v5 build cannot: it needs a master nobody has made.
      const older = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
      expect(older).toEqual({ claimed: false, reason: "inputs_unavailable" });

      const result = await service.claim({
        requestId: request.id,
        userId: OWNER,
        capabilities: { ...capabilities, nativePluginVersion: 6 },
      });
      expect("claimed" in result).toBe(false);
      if ("claimed" in result) return;

      const manifest = result.manifest;
      expect(manifest.stage).toBe("final");
      expect(manifest.buildFromSources).toBe(true);
      expect(manifest.masterUrl).toBeNull();
      expect(manifest.voiceUrl).toContain("signed.example.com");
      expect(manifest.musicUrl).toMatch(/\/music\/happy\.mp3$/);
      expect(manifest.audio.musicSelected).toBe(true);
      expect(manifest.audio.voiceLeadInSeconds).toBeCloseTo(0.6, 5);
      expect(manifest.sources.map((source) => source.assetId)).toEqual([photo.id]);
      expect(manifest.scenes[0].assets[0]).toMatchObject({ motion: "ken_burns_in", durationSeconds: 16 });
      expect(manifest.template.id).toBe("framed_cream");
      expect(manifest.captions[0].startSeconds).toBeCloseTo(0.6, 5);
      expect(manifest.captionLanguages).toEqual(["th", "en"]);
    });

    it("reports availability without taking a lease", async () => {
      const { request, job } = await seed();

      const availability = await service.describeAvailableWork(request.id, OWNER);
      expect(availability).toMatchObject({ available: true, stage: "final", ratio: "9:16" });

      const task = await renderTaskRepository.findActiveByJob(job.id);
      expect(task?.state).toBe("queued");
    });
  });

  // ── completion ───────────────────────────────────────────────────────────

  describe("completing a render", () => {
    async function claimed() {
      const seeded = await seed();
      const result = await service.claim({
        requestId: seeded.request.id,
        userId: OWNER,
        capabilities,
      });
      if ("claimed" in result) throw new Error("expected a claim");
      const attempt = await deviceRenderAttemptRepository.findById(result.attemptId);
      return { ...seeded, attemptId: result.attemptId, uploadKey: attempt!.uploadStorageKey };
    }

    it("verifies the object, creates the asset and closes the claim", async () => {
      const { job, attemptId, uploadKey, request } = await claimed();

      const result = await service.complete(completion(attemptId, job.id, uploadKey));

      expect(result.firstCompletion).toBe(true);
      expect(result.assetId).toBeTruthy();

      const asset = await uploadedAssetRepository.findById(result.assetId!);
      expect(asset?.assetType).toBe(AssetType.FinalClip);
      expect(asset?.storageKey).toBe(uploadKey);
      expect(asset?.videoRatio).toBe("9:16");
      expect(asset?.requestId).toBe(request.id);

      // A poster is always taken from the finished video, never from a source
      // photo; `ensureAssetPoster` is idempotent and does it either way.
      expect(ensureAssetPoster).toHaveBeenCalledWith(
        result.assetId,
        expect.stringContaining("poster-")
      );

      expect(applyDeviceRenderResult).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: job.id, ratio: "9:16", assetId: result.assetId })
      );
      expect(afterRenderStepCompleted).toHaveBeenCalledWith(job.id);

      const task = await renderTaskRepository.findLatestByJob(job.id);
      expect(task?.state).toBe("done");
    });

    it("refuses a silent export", async () => {
      // The specific failure that kept the draft renderer from shipping: the
      // picture was fine and there was no narration at all.
      const { job, attemptId, uploadKey } = await claimed();
      mediaSummary = { ...mediaSummary, hasAudio: false, audioCodec: null };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "silent_output" });

      expect(applyDeviceRenderResult).not.toHaveBeenCalled();
    });

    it("refuses an export with the wrong canvas", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      mediaSummary = { ...mediaSummary, width: 720, height: 1280 };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "wrong_dimensions" });
    });

    it("accepts a portrait video stored sideways with a 90° rotation tag", async () => {
      // What Android's Media3 writes for 9:16 unless portrait encoding is on:
      // 1920x1080 frames, shown upright as 1080x1920.
      const { job, attemptId, uploadKey } = await claimed();
      mediaSummary = {
        ...mediaSummary,
        width: 1920,
        height: 1080,
        rotation: 90,
        displayWidth: 1080,
        displayHeight: 1920,
      };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).resolves.toBeDefined();
    });

    it("still refuses a sideways video that is not rotated back upright", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      mediaSummary = {
        ...mediaSummary,
        width: 1920,
        height: 1080,
        rotation: 0,
        displayWidth: 1920,
        displayHeight: 1080,
      };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "wrong_dimensions" });
    });

    it("refuses an export that is not H.264", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      mediaSummary = { ...mediaSummary, videoCodec: "hevc" };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "wrong_video_codec" });
    });

    it("refuses an export whose length does not match what the device reported", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      mediaSummary = { ...mediaSummary, durationSeconds: 40 };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "duration_mismatch" });
    });

    it("refuses when nothing was actually uploaded", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      headObjectResult = new Error("NoSuchKey");

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "output_missing" });
    });

    it("refuses a file too small to be a video", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      headObjectResult = { ContentLength: 1_000 };

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "output_too_small" });
    });

    it("refuses a completion that does not match what was handed out", async () => {
      const { job, attemptId, uploadKey } = await claimed();

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey, { ratio: "16:9" }))
      ).rejects.toMatchObject({ code: "completion_mismatch" });

      await expect(
        service.complete(
          completion(attemptId, job.id, "final_exports/somewhere/else.mp4")
        )
      ).rejects.toMatchObject({ code: "completion_mismatch" });

      await expect(
        service.complete(completion(attemptId, "another-job", uploadKey))
      ).rejects.toMatchObject({ code: "completion_mismatch" });
    });

    it("refuses a manifest version this build does not honour", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      await expect(
        service.complete(completion(attemptId, job.id, uploadKey, { manifestVersion: 99 }))
      ).rejects.toMatchObject({ code: "unsupported_manifest_version" });
    });

    it("refuses a cover key outside the requester's own prefix", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      await expect(
        service.complete(
          completion(attemptId, job.id, uploadKey, {
            coverStorageKey: "thumbnails/someone-else/poster.jpg",
          })
        )
      ).rejects.toMatchObject({ code: "bad_cover_key" });
    });

    it("refuses another requester's attempt", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      await expect(
        service.complete(completion(attemptId, job.id, uploadKey, { userId: OTHER }))
      ).rejects.toMatchObject({ code: "attempt_not_found" });
    });
  });

  // ── idempotency and recovery ─────────────────────────────────────────────

  describe("retries and recovery", () => {
    async function claimed() {
      const seeded = await seed();
      const result = await service.claim({
        requestId: seeded.request.id,
        userId: OWNER,
        capabilities,
      });
      if ("claimed" in result) throw new Error("expected a claim");
      const attempt = await deviceRenderAttemptRepository.findById(result.attemptId);
      return { ...seeded, attemptId: result.attemptId, uploadKey: attempt!.uploadStorageKey };
    }

    it("returns the first result when a completion is retried", async () => {
      // A phone that uploads and then loses the network retries. A second
      // FinalClip pointing at a second object would give the requester
      // duplicate exports whose storage nobody reclaims.
      const { job, attemptId, uploadKey } = await claimed();

      const first = await service.complete(completion(attemptId, job.id, uploadKey));
      const second = await service.complete(completion(attemptId, job.id, uploadKey));

      expect(first.firstCompletion).toBe(true);
      expect(second.firstCompletion).toBe(false);
      expect(second.assetId).toBe(first.assetId);

      const assets = await uploadedAssetRepository.findByRequestId(job.requestId);
      const finals = assets.filter((asset) => asset.storageKey === uploadKey);
      expect(finals).toHaveLength(1);

      // The pipeline is advanced once, not twice.
      expect(applyDeviceRenderResult).toHaveBeenCalledTimes(1);
      expect(afterRenderStepCompleted).toHaveBeenCalledTimes(1);
    });

    it("lets the owner resume a render the closed app never released, once it lapses", async () => {
      // A studio task is device-only: the worker never reclaims it. Without
      // this, closing the app mid-render left the claim held forever and the
      // video could not be resumed.
      const { request, job, attemptId, uploadKey } = await claimed();

      const soon = await service.describeAvailableWork(request.id, OWNER);
      expect(soon.available).toBe(false);
      expect(soon.reason).toBe("already_rendering");
      expect(soon.resumeInSeconds).toBeGreaterThan(0);
      const early = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
      expect(early).toEqual({ claimed: false, reason: "already_rendering" });

      const realNow = Date.now();
      const clock = jest.spyOn(Date, "now").mockReturnValue(realNow + 61_000);
      try {
        const later = await service.describeAvailableWork(request.id, OWNER);
        expect(later).toMatchObject({ available: true, interrupted: true });

        const resumed = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
        if ("claimed" in resumed) throw new Error("expected the resume to claim");
        expect(resumed.attemptId).not.toBe(attemptId);

        const task = await renderTaskRepository.findActiveByJob(job.id);
        expect(task?.state).toBe("claimed");
        expect(task?.claimedBy).toBe(resumed.attemptId);
        expect((await deviceRenderAttemptRepository.findById(attemptId))?.state).toBe("expired");
      } finally {
        clock.mockRestore();
      }

      // The abandoned attempt can no longer complete over the resumed one.
      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "attempt_superseded" });
    });

    it("never takes a quiet claim away from the worker", async () => {
      const { request } = await seed();
      await renderTaskRepository.claimNext("mac-worker", 120);

      const realNow = Date.now();
      const clock = jest.spyOn(Date, "now").mockReturnValue(realNow + 3_600_000);
      try {
        const availability = await service.describeAvailableWork(request.id, OWNER);
        expect(availability).toEqual({ available: false, reason: "already_rendering" });
        const result = await service.claim({ requestId: request.id, userId: OWNER, capabilities });
        expect(result).toEqual({ claimed: false, reason: "already_rendering" });
      } finally {
        clock.mockRestore();
      }
    });

    it("releases the task back to the queue with its position intact", async () => {
      const { job, attemptId } = await claimed();

      const released = await service.release(attemptId, OWNER, "cancelled");
      expect(released.released).toBe(true);

      const task = await renderTaskRepository.findActiveByJob(job.id);
      expect(task?.state).toBe("queued");
      expect(task?.claimedBy).toBeNull();

      // And the worker can now take it.
      const claimedByWorker = await renderTaskRepository.claimNext("mac-worker", 120);
      expect(claimedByWorker?.claimedBy).toBe("mac-worker");
    });

    it("keeps the phone's step-by-step log with a failed attempt", async () => {
      const { attemptId } = await claimed();
      const log = [
        "[  0.0s] Claimed attempt dev_1",
        "[ 12.3s]   Attempt with cross-dissolves FAILED — ExportException[ERROR_CODE_DECODING_FAILED]",
      ];

      await service.release(attemptId, OWNER, "Failed while making the video on this phone: x", log);

      const attempt = await deviceRenderAttemptRepository.findById(attemptId);
      expect(attempt?.state).toBe("failed");
      expect(attempt?.error).toContain("Failed while making the video");
      expect(attempt?.result).toEqual({ errorLog: log });
    });

    it("tells a device on its heartbeat when the work was reclaimed", async () => {
      const { attemptId, task } = await claimed();

      // The worker reclaims a stale claim through its normal path.
      await renderTaskRepository.releaseClaim(task.id, attemptId);
      await renderTaskRepository.claimNext("mac-worker", 120);

      const progress = await service.reportProgress(attemptId, OWNER, 40);
      expect(progress).toMatchObject({ ok: false, cancelled: true });

      const attempt = await deviceRenderAttemptRepository.findById(attemptId);
      expect(attempt?.state).toBe("expired");
    });

    it("does not let a lapsed attempt overwrite the worker's result", async () => {
      const { job, attemptId, uploadKey, task } = await claimed();

      await renderTaskRepository.releaseClaim(task.id, attemptId);
      await renderTaskRepository.claimNext("mac-worker", 120);

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "lease_lost" });

      expect(applyDeviceRenderResult).not.toHaveBeenCalled();
      const latest = await renderTaskRepository.findLatestByJob(job.id);
      expect(latest?.claimedBy).toBe("mac-worker");
    });

    it("refuses a completion from an attempt that was already released", async () => {
      const { job, attemptId, uploadKey } = await claimed();
      await service.release(attemptId, OWNER, "cancelled");

      await expect(
        service.complete(completion(attemptId, job.id, uploadKey))
      ).rejects.toMatchObject({ code: "attempt_superseded" });
    });

    it("sweeps lapsed leases so a late completion is refused, not honoured", async () => {
      const { attemptId } = await claimed();
      await deviceRenderAttemptRepository.update(attemptId, {
        leaseExpiresAt: new Date(Date.now() - 60_000),
      });

      expect(await service.expireLapsedAttempts()).toBe(1);
      const attempt = await deviceRenderAttemptRepository.findById(attemptId);
      expect(attempt?.state).toBe("expired");
    });

    it("mirrors progress onto the job so the existing bar keeps working", async () => {
      const { job, attemptId } = await claimed();

      const progress = await service.reportProgress(attemptId, OWNER, 42.5);
      expect(progress.ok).toBe(true);
      expect(progress.cancelled).toBe(false);

      const updated = await videoGenerationJobRepository.findById(job.id);
      expect(updated?.renderProgress).toBeCloseTo(42.5, 5);
      expect(updated?.renderProgressDetail).toMatchObject({ unit: "9:16" });
    });

    it("reports an unknown attempt as not found rather than leaking its existence", async () => {
      await expect(service.reportProgress("dev_nope", OWNER, 10)).rejects.toBeInstanceOf(
        DeviceRenderError
      );
    });
  });
});

describe("stageForTask", () => {
  it("reads an extra shape's stage from its chain link", () => {
    for (const stage of ["montage", "master", "final"] as const) {
      expect(
        stageForTask({
          step: RenderStep.AdditionalRatios,
          payload: { deviceChain: true, ratio: "16:9", stage, queue: [] },
        })
      ).toBe(stage);
    }
  });

  it("falls back to the step for every other task", () => {
    expect(stageForTask({ step: RenderStep.AdditionalRatios, payload: null })).toBe("final");
    expect(stageForTask({ step: RenderStep.MontageAllSegments, payload: null })).toBe("montage");
    expect(stageForTask({ step: RenderStep.FfmpegComposition, payload: null })).toBe("master");
    expect(stageForTask({ step: RenderStep.OverlayComposition, payload: null })).toBe("final");
  });
});
