/**
 * Per-step render progress (% bar) — Migration 016.
 *
 * Covers the service-side progress writer and the dispatch-time reset:
 *   - `_progressWriter` persists renderProgress (0–100) + detail, throttled
 *     (≥3 percentage points between writes; 100 always written),
 *   - the bar never moves backwards within a step,
 *   - writes are fire-and-forget (a repo failure never throws into the render),
 *   - `_dispatchHeavy` resets renderProgress/renderProgressDetail to NULL
 *     before the heavy step runs, so a previous step's % never bleeds through.
 *
 * Fresh Mock repos via `new Map()` per CLAUDE.md.
 */

import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { RenderStep } from "@/domain/enums/RenderStep";

jest.mock("@/repositories/index", () => ({
  clipRequestRepository: new (require("@/repositories/mock/MockClipRequestRepository").MockClipRequestRepository)(new Map()),
  uploadedAssetRepository: new (require("@/repositories/mock/MockUploadedAssetRepository").MockUploadedAssetRepository)(new Map()),
  videoGenerationJobRepository: new (require("@/repositories/mock/MockVideoGenerationJobRepository").MockVideoGenerationJobRepository)(new Map()),
  videoPublishRecordRepository: new (require("@/repositories/mock/MockVideoPublishRecordRepository").MockVideoPublishRecordRepository)(new Map()),
}));

import { VideoGenerationService } from "@/services/VideoGenerationService";

const { videoGenerationJobRepository: mockJobRepo } =
  jest.requireMock("@/repositories/index");

/** Flush the writer's fire-and-forget update promises. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function createJob(currentStep: VideoGenerationStep) {
  return mockJobRepo.create({
    requestId: "req-progress-001",
    status: VideoGenerationJobStatus.Active,
    currentStep,
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
    approvedScriptThai: null,
    approvedScriptEnglish: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,
    ttsTaskId: null,
    rvcVoiceModel: "",
    voiceRecordingAssetId: null,
    processedVoiceAssetId: null,
    selectedMusicTrack: null,
    voiceDurationSeconds: null,
    voiceTimestamps: null,
    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    baseVideoAssetId: null,
    sceneVideoAssetIds: null,
    subtitleTimeline: null,
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
    contentApprovedBy: null,
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,
  });
}

describe("VideoGenerationService — render progress writer", () => {
  it("persists progress + detail and always writes 100", async () => {
    const job = await createJob(VideoGenerationStep.GeneratingAdditionalRatios);
    const service = new VideoGenerationService() as any;
    const write = service._progressWriter(job.id);

    write(0, { unit: "16:9", unitsDone: 0, unitsTotal: 2 });
    await flush();
    let latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(0);
    expect(latest.renderProgressDetail).toEqual({
      unit: "16:9",
      unitsDone: 0,
      unitsTotal: 2,
    });

    write(50, { unit: "16:9", unitsDone: 1, unitsTotal: 2 });
    write(100, { unit: "4:5", unitsDone: 2, unitsTotal: 2 });
    await flush();
    latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(100);
    expect(latest.renderProgressDetail).toEqual({
      unit: "4:5",
      unitsDone: 2,
      unitsTotal: 2,
    });
  });

  it("throttles small increments (<3 points within the time window)", async () => {
    const job = await createJob(VideoGenerationStep.GeneratingBaseVideo);
    const service = new VideoGenerationService() as any;
    const write = service._progressWriter(job.id);

    write(10);
    await flush();
    write(11); // +1 point within 3s — skipped
    write(12); // +2 points within 3s — skipped
    await flush();
    let latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(10);

    write(14); // +4 points — written
    await flush();
    latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(14);
  });

  it("never moves the persisted % backwards", async () => {
    const job = await createJob(VideoGenerationStep.GeneratingOverlay);
    const service = new VideoGenerationService() as any;
    const write = service._progressWriter(job.id);

    write(60);
    await flush();
    write(40); // out-of-order callback — must not regress the bar
    await flush();
    const latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(60);
  });

  it("clamps out-of-range values into 0–100", async () => {
    const job = await createJob(VideoGenerationStep.GeneratingBaseVideo);
    const service = new VideoGenerationService() as any;
    const write = service._progressWriter(job.id);

    write(-20);
    await flush();
    let latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(0);

    write(250);
    await flush();
    latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBe(100);
  });

  it("swallows repository failures (progress must never fail a render)", async () => {
    const service = new VideoGenerationService() as any;
    const write = service._progressWriter("no-such-job-id");
    expect(() => write(50)).not.toThrow();
    await flush(); // rejection is caught internally — no unhandled rejection
  });
});

describe("VideoGenerationService — dispatch resets progress", () => {
  it("nulls renderProgress/renderProgressDetail before running the heavy step", async () => {
    const job = await createJob(VideoGenerationStep.GeneratingAdditionalRatios);
    // Simulate leftover % from the previous step.
    await mockJobRepo.update(job.id, {
      renderProgress: 95,
      renderProgressDetail: { unit: "9:16" },
    });

    const service = new VideoGenerationService() as any;
    let progressAtRunTime: number | null | undefined;
    await service._dispatchHeavy(job, RenderStep.AdditionalRatios, async () => {
      const atRun = await mockJobRepo.findById(job.id);
      progressAtRunTime = atRun.renderProgress;
    });
    await flush();

    const latest = await mockJobRepo.findById(job.id);
    expect(latest.renderProgress).toBeNull();
    expect(latest.renderProgressDetail).toBeNull();
    // The inline step observed the reset too (reset happens BEFORE dispatch).
    expect(progressAtRunTime).toBeNull();
  });
});
