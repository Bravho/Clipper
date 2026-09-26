/**
 * The channel shapes of a phone-rendered request.
 *
 * The main video stops at its review even on the express lane, so the studio
 * can show it; the other shapes are the ones the requester picks, and each is
 * rendered montage → master → final ON THE PHONE, one queued task at a time,
 * before the request is delivered. None of it touches the server path.
 *
 * Fresh Mock repos via `new Map()` per CLAUDE.md.
 */

import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { MockVideoGenerationJobRepository } from "@/repositories/mock/MockVideoGenerationJobRepository";
import { MockRenderTaskRepository } from "@/repositories/mock/MockRenderTaskRepository";
import { Platform } from "@/domain/enums/Platform";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { RenderStep } from "@/domain/enums/RenderStep";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";

jest.mock("@/repositories/index", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
  uploadedAssetRepository: new (require("@/repositories/mock/MockUploadedAssetRepository").MockUploadedAssetRepository)(new Map()),
  videoGenerationJobRepository: new (require("@/repositories/mock/MockVideoGenerationJobRepository").MockVideoGenerationJobRepository)(new Map()),
  renderTaskRepository: new (require("@/repositories/mock/MockRenderTaskRepository").MockRenderTaskRepository)(new Map()),
  videoPublishRecordRepository: new (require("@/repositories/mock/MockVideoPublishRecordRepository").MockVideoPublishRecordRepository)(new Map()),
}));

// No Mac worker: a phone-rendered request's steps are queued for the phone
// either way, which is exactly what these tests check.
jest.mock("@/config/renderQueue", () => ({
  RENDER_QUEUE: { enabled: false, workerFreshSeconds: 60 },
  renderPriorityForRequest: () => 0,
}));

jest.mock("@/lib/ai/ffmpegService", () => ({
  getRequiredRatiosForPlatforms: (platforms: string[]) => {
    const ratios = new Set<string>();
    for (const p of platforms) {
      if (p === "tiktok" || p === "travy_app") ratios.add("9:16");
      else if (p === "youtube" || p === "facebook") ratios.add("16:9");
      else if (p === "instagram") ratios.add("4:5");
    }
    return Array.from(ratios);
  },
}));

const {
  clipRequestRepository: mockClipRepo,
  videoGenerationJobRepository: mockJobRepo,
  renderTaskRepository: mockTaskRepo,
  uploadedAssetRepository: mockAssetRepo,
} = jest.requireMock("@/repositories/index") as {
  uploadedAssetRepository: MockUploadedAssetRepository;
  clipRequestRepository: MockClipRequestRepository;
  videoGenerationJobRepository: MockVideoGenerationJobRepository;
  renderTaskRepository: MockRenderTaskRepository;
};

import {
  VideoGenerationService,
  StepLockedAfterApprovalError,
  VoiceMakeLimitError,
} from "@/services/VideoGenerationService";
import { MAX_VOICE_MAKES_PER_REQUEST } from "@/config/requestLimits";
import { ELEVENLABS_VOICE_FILE_NAME } from "@/lib/ai/elevenLabsTtsService";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import type { MockUploadedAssetRepository } from "@/repositories/mock/MockUploadedAssetRepository";

const USER_ID = "user-dev-1";

async function createRequest(renderLocation: "device" | "server") {
  const request = await mockClipRepo.create({
    userId: USER_ID,
    title: "Phone clip",
    description: "desc",
    targetAudience: "All",
    targetPlatforms: [Platform.TikTok, Platform.YouTube, Platform.Instagram],
    preferredStyle: "Dynamic",
    preferredLanguage: "Thai",
    durationSeconds: 20,
  });
  await mockClipRepo.updateStatus(request.id, RequestStatus.Editing, { renderLocation });
  return request;
}

async function createJob(requestId: string, step: VideoGenerationStep, extra: Record<string, unknown> = {}) {
  return mockJobRepo.create({
    requestId,
    status: VideoGenerationJobStatus.Active,
    currentStep: step,
    currentSceneIndex: 0,
    scenePlan: null,
    scriptThai: "สวัสดี",
    scriptEnglish: null,
    scriptChinese: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: "[]",
    approvedScriptThai: "สวัสดี",
    approvedScriptEnglish: null,
    approvedScriptChinese: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: "",
    voiceRecordingAssetId: null,
    processedVoiceAssetId: "voice",
    selectedMusicTrack: null,
    voiceDurationSeconds: 12,
    voiceTimestamps: null,
    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: "base_9x16",
    subtitleTimeline: null,
    animationSpec: null,
    animatedVideoAssetId: null,
    animatedOverlayAssetIds: null,
    subtitleLanguages: ["en", "zh"],
    finalExport_9_16_assetId: "master_9x16",
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_travy_assetId: null,
    failedAtStep: null,
    contentApprovedBy: USER_ID,
    videoApprovedBy: USER_ID,
    voiceApprovedBy: USER_ID,
    animationApprovedBy: USER_ID,
    finalApprovedBy: USER_ID,
    ...extra,
  });
}

/** Finish the active chain task the way `DeviceRenderService.complete` does. */
async function finishActiveLink(service: VideoGenerationService, jobId: string, assetId: string) {
  const task = await mockTaskRepo.findActiveByJob(jobId);
  if (!task) throw new Error("no active task");
  const payload = task.payload as { ratio: "16:9" | "4:5"; stage: string };
  const applied = await service.applyDeviceRenderResult({
    jobId,
    step: task.step,
    ratio: payload.ratio,
    assetId,
    stage: payload.stage,
    payload: task.payload,
  });
  await mockTaskRepo.claimForDevice(task.id, USER_ID, `att_${assetId}`, [task.step]);
  await mockTaskRepo.completeClaim(task.id, `att_${assetId}`);
  if (applied.chain) await service.advanceDeviceRatioChain(jobId, applied.chain);
  return { task, applied };
}

describe("VideoGenerationService — channel shapes of a phone-rendered request", () => {
  let service: VideoGenerationService;

  beforeEach(() => {
    service = new VideoGenerationService();
    // Publishing drafts call Gemini; they are not what these tests are about.
    jest
      .spyOn(VideoGenerationService.prototype as any, "_generatePublishingDrafts")
      .mockResolvedValue({});
    jest
      .spyOn(VideoGenerationService.prototype as any, "_attachChannelPreviews")
      .mockImplementation(async (...args: unknown[]) => args[2]);
  });

  afterEach(() => jest.restoreAllMocks());

  it("stops the express lane at the main video's review for a phone-rendered request", async () => {
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.GeneratingOverlay, {
      autoApproveRemaining: true,
    });
    await service.applyDeviceRenderResult({
      jobId: job.id,
      step: RenderStep.OverlayComposition,
      ratio: "9:16",
      assetId: "captioned_9x16",
    });
    const updated = await mockJobRepo.findById(job.id);
    expect(updated?.currentStep).toBe(VideoGenerationStep.AwaitingOverlayApproval);
    expect(updated?.captionedExport_9_16_assetId).toBe("captioned_9x16");
    expect(updated?.autoApproveRemaining).toBe(false);
  });

  it("leaves the express lane on for a server request", async () => {
    const request = await createRequest("server");
    const job = await createJob(request.id, VideoGenerationStep.GeneratingOverlay, {
      autoApproveRemaining: true,
    });
    await service.applyDeviceRenderResult({
      jobId: job.id,
      step: RenderStep.OverlayComposition,
      ratio: "9:16",
      assetId: "captioned_9x16",
    });
    expect((await mockJobRepo.findById(job.id))?.autoApproveRemaining).toBe(true);
  });

  it("renders only the chosen shapes, each montage → master → final, then delivers", async () => {
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingAdditionalRatios);

    await service.generateAdditionalRatiosByRequester(job.id, USER_ID, ["4:5"]);
    expect((await mockJobRepo.findById(job.id))?.currentStep).toBe(
      VideoGenerationStep.GeneratingAdditionalRatios
    );

    const first = await mockTaskRepo.findActiveByJob(job.id);
    expect(first?.step).toBe(RenderStep.AdditionalRatios);
    expect(first?.deviceOnly).toBe(true);
    expect(first?.payload).toMatchObject({ ratio: "4:5", stage: "montage", queue: [] });

    await finishActiveLink(service, job.id, "montage_4x5");
    const master = await mockTaskRepo.findActiveByJob(job.id);
    expect(master?.payload).toMatchObject({ ratio: "4:5", stage: "master", baseAssetId: "montage_4x5" });

    await finishActiveLink(service, job.id, "master_4x5");
    expect((await mockJobRepo.findById(job.id))?.finalExport_4_5_assetId).toBe("master_4x5");
    const final = await mockTaskRepo.findActiveByJob(job.id);
    expect(final?.payload).toMatchObject({ ratio: "4:5", stage: "final" });

    await finishActiveLink(service, job.id, "captioned_4x5");
    const done = await mockJobRepo.findById(job.id);
    expect(done?.captionedExport_4_5_assetId).toBe("captioned_4x5");
    // 16:9 was not chosen, so it was never made.
    expect(done?.captionedExport_16_9_assetId ?? null).toBeNull();
    expect(done?.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
    expect(await mockTaskRepo.findActiveByJob(job.id)).toBeNull();
    expect((await mockClipRepo.findById(request.id))?.status).toBe(RequestStatus.Delivered);
  });

  it("records a shape's master when a newer phone skipped its silent montage", async () => {
    // Plugin v6+ is handed the montage link as a MASTER composed from the
    // originals; what comes back is the master, and the chain moves to final.
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingAdditionalRatios);
    await service.generateAdditionalRatiosByRequester(job.id, USER_ID, ["16:9"]);
    const task = await mockTaskRepo.findActiveByJob(job.id);
    expect(task?.payload).toMatchObject({ stage: "montage" });

    const applied = await service.applyDeviceRenderResult({
      jobId: job.id,
      step: RenderStep.AdditionalRatios,
      ratio: "16:9",
      assetId: "master_16x9",
      stage: "master",
      payload: task!.payload,
    });
    expect((await mockJobRepo.findById(job.id))?.finalExport_16_9_assetId).toBe("master_16x9");
    expect(applied.chain).toMatchObject({ ratio: "16:9", stage: "final" });
  });

  it("finishes straight away when no other shape is chosen", async () => {
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingAdditionalRatios);
    await service.generateAdditionalRatiosByRequester(job.id, USER_ID, []);
    expect((await mockJobRepo.findById(job.id))?.currentStep).toBe(
      VideoGenerationStep.AwaitingDistributionReview
    );
    expect(await mockTaskRepo.findActiveByJob(job.id)).toBeNull();
  });
});

describe("Regenerate the video (studio)", () => {
  it("refuses to remake an approved phone video (2026-09-27: approved steps are final)", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingOverlayApproval, {
      captionedExport_9_16_assetId: "final_9x16",
      autoApproveRemaining: true,
    });

    await expect(service.reopenDeviceProductionByRequester(job.id, USER_ID)).rejects.toBeInstanceOf(
      StepLockedAfterApprovalError
    );
    // Nothing moved: the finished video is still the result.
    const after = (await mockJobRepo.findById(job.id))!;
    expect(after.currentStep).toBe(VideoGenerationStep.AwaitingOverlayApproval);
    expect(after.captionedExport_9_16_assetId).toBe("final_9x16");
  });

  it("refuses a server-rendered request", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("server");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingOverlayApproval);
    await expect(service.reopenDeviceProductionByRequester(job.id, USER_ID)).rejects.toThrow(
      /made on the phone/
    );
    expect((await mockJobRepo.findById(job.id))!.currentStep).toBe(
      VideoGenerationStep.AwaitingOverlayApproval
    );
  });

  it("refuses anywhere but the finished-video review", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.GeneratingAdditionalRatios);
    await expect(service.reopenDeviceProductionByRequester(job.id, USER_ID)).rejects.toThrow();
  });
});

describe("A skipped channel shape after delivery (studio, 26 Sep)", () => {
  let service: VideoGenerationService;
  beforeEach(() => {
    service = new VideoGenerationService();
    jest
      .spyOn(VideoGenerationService.prototype as any, "_generatePublishingDrafts")
      .mockResolvedValue({});
    jest
      .spyOn(VideoGenerationService.prototype as any, "_attachChannelPreviews")
      .mockImplementation(async (...args: unknown[]) => args[2]);
  });
  afterEach(() => jest.restoreAllMocks());

  it("makes a shape that was not chosen the first time", async () => {
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingDistributionReview, {
      captionedExport_9_16_assetId: "captioned_9x16",
    });

    await service.generateAdditionalRatiosByRequester(job.id, USER_ID, ["4:5"]);
    expect((await mockJobRepo.findById(job.id))?.currentStep).toBe(
      VideoGenerationStep.GeneratingAdditionalRatios
    );
    const first = await mockTaskRepo.findActiveByJob(job.id);
    expect(first?.payload).toMatchObject({ ratio: "4:5", stage: "montage", queue: [] });

    await finishActiveLink(service, job.id, "montage_4x5");
    await finishActiveLink(service, job.id, "master_4x5");
    await finishActiveLink(service, job.id, "captioned_4x5");
    const done = await mockJobRepo.findById(job.id);
    expect(done?.captionedExport_4_5_assetId).toBe("captioned_4x5");
    expect(done?.captionedExport_9_16_assetId).toBe("captioned_9x16");
    expect(done?.currentStep).toBe(VideoGenerationStep.AwaitingDistributionReview);
  });

  it("does not remake a shape that is already made", async () => {
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingDistributionReview, {
      captionedExport_4_5_assetId: "captioned_4x5",
    });
    await expect(
      service.generateAdditionalRatiosByRequester(job.id, USER_ID, ["4:5"])
    ).rejects.toThrow(/already made/);
    expect((await mockJobRepo.findById(job.id))?.currentStep).toBe(
      VideoGenerationStep.AwaitingDistributionReview
    );
  });

  it("keeps a server request's delivered job closed", async () => {
    const request = await createRequest("server");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingDistributionReview);
    await expect(
      service.generateAdditionalRatiosByRequester(job.id, USER_ID, ["4:5"])
    ).rejects.toThrow();
  });
});

describe("The voice must fit the picked material (studio, 26 Sep)", () => {
  const media = (clipSeconds: number[], photos = 0) => ({
    renderPayload: {
      mediaMode: "local-first",
      localMedia: [
        ...clipSeconds.map((seconds, index) => ({
          localId: `clip-${index}`,
          fileName: `clip-${index}.mp4`,
          mimeType: "video/mp4",
          fileSizeBytes: 1000,
          durationSeconds: seconds,
        })),
        ...Array.from({ length: photos }, (_, index) => ({
          localId: `photo-${index}`,
          fileName: `photo-${index}.jpg`,
          mimeType: "image/jpeg",
          fileSizeBytes: 1000,
          durationSeconds: null,
        })),
      ],
    },
  });

  beforeEach(() => {
    jest
      .spyOn(VideoGenerationService.prototype as any, "_runSceneDesignGeneration")
      .mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("refuses a voice longer than the material minus the allowance", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    // 10 s + 8 s of clips + 1 photo (3 s) = 21 s; allowance 2 s → voice ≤ 19 s.
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      voiceDurationSeconds: 19.5,
      ...media([10, 8], 1),
    });
    await expect(service.approveVoiceConversionByRequester(job.id, USER_ID)).rejects.toMatchObject({
      code: "voice_too_long_for_material",
      materialSeconds: 21,
      maxVoiceSeconds: 19,
    });
    expect((await mockJobRepo.findById(job.id))?.currentStep).toBe(
      VideoGenerationStep.AwaitingVoiceApproval
    );
  });

  it("accepts a voice that fits", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      voiceDurationSeconds: 18.9,
      ...media([10, 8], 1),
    });
    const updated = await service.approveVoiceConversionByRequester(job.id, USER_ID);
    expect(updated.currentStep).toBe(VideoGenerationStep.GeneratingSceneDesign);
  });
});

describe("Making the voice again from an edited script (studio, 26 Sep)", () => {
  beforeEach(() => {
    jest
      .spyOn(VideoGenerationService.prototype as any, "_runIAppTtsGeneration")
      .mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("replaces the approved script and drops the old translations", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      approvedScriptEnglish: "Hello",
      scriptEnglish: "Hello",
    });
    const updated = await service.regenerateVoice(job.id, USER_ID, undefined, "สวัสดีครับ ใหม่");
    expect(updated.currentStep).toBe(VideoGenerationStep.GeneratingVoice);
    expect(updated.approvedScriptThai).toBe("สวัสดีครับ ใหม่");
    expect(updated.approvedScriptEnglish ?? null).toBeNull();
    expect(updated.scriptEnglish ?? null).toBeNull();
  });

  it("keeps everything when the script is unchanged", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval, {
      approvedScriptEnglish: "Hello",
    });
    const updated = await service.regenerateVoice(job.id, USER_ID, undefined, "สวัสดี");
    expect(updated.approvedScriptThai).toBe("สวัสดี");
    expect(updated.approvedScriptEnglish).toBe("Hello");
  });
});

describe("Per-request limits (2026-09-27)", () => {
  async function addVoiceMakes(requestId: string, count: number) {
    for (let n = 0; n < count; n++) {
      await mockAssetRepo.create({
        requestId,
        userId: USER_ID,
        fileName: ELEVENLABS_VOICE_FILE_NAME,
        assetType: AssetType.StaffVoiceRecording,
        fileSizeBytes: 1000,
        mimeType: "audio/mpeg",
        storageKey: `voice_recordings/${USER_ID}/${requestId}/${n}.mp3`,
        storageUrl: `https://example.test/${n}.mp3`,
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        scheduledDeletionAt: new Date(Date.now() + 86_400_000),
      } as never);
    }
  }

  it("counts only the voices ElevenLabs made for this request", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    await addVoiceMakes(request.id, 2);
    expect(await service.voiceMakesFor(request.id)).toEqual({
      used: 2,
      limit: MAX_VOICE_MAKES_PER_REQUEST,
    });
  });

  it("allows the voice to be made again below the limit", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    await addVoiceMakes(request.id, MAX_VOICE_MAKES_PER_REQUEST - 1);
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval);
    const updated = await service.regenerateVoice(job.id, USER_ID);
    expect(updated.currentStep).toBe(VideoGenerationStep.GeneratingVoice);
  });

  it("refuses a sixth voice make and leaves the job where it was", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    await addVoiceMakes(request.id, MAX_VOICE_MAKES_PER_REQUEST);
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval);
    await expect(service.regenerateVoice(job.id, USER_ID)).rejects.toBeInstanceOf(
      VoiceMakeLimitError
    );
    expect((await mockJobRepo.findById(job.id))!.currentStep).toBe(
      VideoGenerationStep.AwaitingVoiceApproval
    );
  });

  it("refuses to remake an approved voice from the scene-design step", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingSceneDesignApproval);
    await expect(service.regenerateVoice(job.id, USER_ID)).rejects.toBeInstanceOf(
      StepLockedAfterApprovalError
    );
  });

  it("refuses to re-caption an approved phone video", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingOverlayApproval);
    await expect(service.regenerateOverlayByRequester(job.id, USER_ID)).rejects.toBeInstanceOf(
      StepLockedAfterApprovalError
    );
  });

  it("leaves a server-pipeline request's revision gates alone", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("server");
    await addVoiceMakes(request.id, MAX_VOICE_MAKES_PER_REQUEST + 2);
    const job = await createJob(request.id, VideoGenerationStep.AwaitingVoiceApproval);
    const updated = await service.regenerateVoice(job.id, USER_ID);
    expect(updated.currentStep).toBe(VideoGenerationStep.GeneratingVoice);
  });
});
