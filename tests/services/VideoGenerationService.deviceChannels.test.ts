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
} = jest.requireMock("@/repositories/index") as {
  clipRequestRepository: MockClipRequestRepository;
  videoGenerationJobRepository: MockVideoGenerationJobRepository;
  renderTaskRepository: MockRenderTaskRepository;
};

import { VideoGenerationService } from "@/services/VideoGenerationService";

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
  it("puts a finished phone video back at the scene-design gate and hides the old result", async () => {
    const service = new VideoGenerationService();
    const request = await createRequest("device");
    const job = await createJob(request.id, VideoGenerationStep.AwaitingOverlayApproval, {
      captionedExport_9_16_assetId: "final_9x16",
      autoApproveRemaining: true,
    });

    const reopened = await service.reopenDeviceProductionByRequester(job.id, USER_ID);

    expect(reopened.currentStep).toBe(VideoGenerationStep.AwaitingSceneDesignApproval);
    expect(reopened.baseVideoAssetId).toBeNull();
    expect(reopened.finalExport_9_16_assetId).toBeNull();
    expect(reopened.captionedExport_9_16_assetId).toBeNull();
    expect(reopened.autoApproveRemaining).toBe(false);
    // The approved script and voice are kept.
    expect(reopened.processedVoiceAssetId).toBe("voice");
    expect(reopened.approvedScriptThai).toBe("สวัสดี");
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
