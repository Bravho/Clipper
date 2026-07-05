import { MockVideoGenerationJobRepository } from "@/repositories/mock/MockVideoGenerationJobRepository";
import { CreateVideoGenerationJobInput } from "@/domain/models/VideoGenerationJob";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { RenderStep } from "@/domain/enums/RenderStep";

/**
 * Render-queue claim semantics (Mac Mini worker offload). These validate the
 * atomic-claim / heartbeat contract the worker and the web-side `_dispatchHeavy`
 * seam depend on, against the Mock repo (mirrors the Postgres SQL behaviour).
 */

function baseJob(requestId: string): CreateVideoGenerationJobInput {
  // Minimal valid job; only the fields the queue logic reads matter here.
  return {
    requestId,
    status: VideoGenerationJobStatus.Active,
    currentStep: VideoGenerationStep.ComposingFinalVideo,
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
    videoGenTaskIds: null,
    videoGenTaskId: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: null,
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
  };
}

describe("render-queue claim semantics", () => {
  beforeEach(() => {
    // Heartbeats live in a process-global; reset so cases don't leak liveness.
    (global as { __mockRenderWorkerHeartbeats?: Map<string, number> }).__mockRenderWorkerHeartbeats =
      new Map();
  });

  it("reports no worker alive until a fresh heartbeat is recorded", async () => {
    const repo = new MockVideoGenerationJobRepository(new Map());
    expect(await repo.isRenderWorkerAlive(45)).toBe(false);
    await repo.recordWorkerHeartbeat("mac-1");
    expect(await repo.isRenderWorkerAlive(45)).toBe(true);
  });

  it("treats a heartbeat older than the freshness window as not alive", async () => {
    const repo = new MockVideoGenerationJobRepository(new Map());
    await repo.recordWorkerHeartbeat("mac-1");
    // Backdate the heartbeat 120s.
    const hb = (global as { __mockRenderWorkerHeartbeats: Map<string, number> })
      .__mockRenderWorkerHeartbeats;
    hb.set("mac-1", Date.now() - 120_000);
    expect(await repo.isRenderWorkerAlive(45)).toBe(false);
  });

  it("claims a queued step exactly once; a second claim finds nothing", async () => {
    const repo = new MockVideoGenerationJobRepository(new Map());
    const job = await repo.create(baseJob("req-1"));
    await repo.update(job.id, {
      renderState: "queued",
      renderStep: RenderStep.FfmpegComposition,
      renderPayload: null,
    });

    const claimed = await repo.claimNextQueuedRenderStep("mac-1", 600);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.renderState).toBe("claimed");
    expect(claimed?.claimedBy).toBe("mac-1");
    expect(claimed?.renderStep).toBe(RenderStep.FfmpegComposition);

    // No other queued work → second claim returns null (won't re-grab a fresh claim).
    expect(await repo.claimNextQueuedRenderStep("mac-2", 600)).toBeNull();
  });

  it("reclaims a claim whose keep-alive has gone stale (crashed worker)", async () => {
    const store = new Map();
    const repo = new MockVideoGenerationJobRepository(store);
    const job = await repo.create(baseJob("req-2"));
    await repo.update(job.id, {
      renderState: "queued",
      renderStep: RenderStep.OverlayComposition,
    });
    const first = await repo.claimNextQueuedRenderStep("mac-1", 600);
    expect(first?.claimedBy).toBe("mac-1");

    // Fresh claim is NOT reclaimable.
    expect(await repo.claimNextQueuedRenderStep("mac-2", 600)).toBeNull();

    // Backdate the keep-alive well beyond the 600s stale window → reclaimable.
    const stored = store.get(job.id)!;
    stored.renderHeartbeatAt = new Date(Date.now() - 20 * 60_000);
    const second = await repo.claimNextQueuedRenderStep("mac-2", 600);
    expect(second?.id).toBe(job.id);
    expect(second?.claimedBy).toBe("mac-2");
  });

  it("marks a claim done/failed via completeRenderClaim", async () => {
    const repo = new MockVideoGenerationJobRepository(new Map());
    const job = await repo.create(baseJob("req-3"));
    await repo.update(job.id, { renderState: "queued", renderStep: RenderStep.AdditionalRatios });
    await repo.claimNextQueuedRenderStep("mac-1", 600);

    await repo.completeRenderClaim(job.id, "done");
    expect((await repo.findById(job.id))?.renderState).toBe("done");
    // A 'done' job is no longer claimable.
    expect(await repo.claimNextQueuedRenderStep("mac-1", 600)).toBeNull();
  });
});
