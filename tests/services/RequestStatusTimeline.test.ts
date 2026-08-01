import { PIPELINE_PHASES } from "@/config/pipelinePresentation";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { RequestStatusHistory } from "@/domain/models/RequestStatusHistory";
import type { VideoGenerationStepHistoryEntry } from "@/domain/models/VideoGenerationJob";
import { RequestPresentationService } from "@/services/RequestPresentationService";

const service = new RequestPresentationService();

function stepEntry(
  id: string,
  step: VideoGenerationStep,
  minute: number
): VideoGenerationStepHistoryEntry {
  return {
    id,
    jobId: "job-1",
    requestId: "request-1",
    step,
    sceneIndex: null,
    createdAt: new Date(Date.UTC(2026, 6, 28, 6, minute)),
  };
}

function statusEntry(
  id: string,
  status: RequestStatus,
  minute: number
): RequestStatusHistory {
  return {
    id,
    requestId: "request-1",
    status,
    note: null,
    changedAt: new Date(Date.UTC(2026, 6, 28, 5, minute)),
  };
}

describe("RequestPresentationService.buildStatusTimeline", () => {
  const completeJourney = [
    stepEntry("step-1", VideoGenerationStep.AnalyzingContent, 0),
    stepEntry("step-2", VideoGenerationStep.GeneratingVoice, 5),
    stepEntry("step-3", VideoGenerationStep.GeneratingSceneDesign, 10),
    stepEntry("step-4", VideoGenerationStep.GeneratingBaseVideo, 15),
    stepEntry("step-5", VideoGenerationStep.MergingScenes, 20),
    stepEntry("step-6", VideoGenerationStep.ComposingFinalVideo, 25),
    stepEntry("step-7", VideoGenerationStep.GeneratingOverlay, 30),
    stepEntry("step-8", VideoGenerationStep.GeneratingAdditionalRatios, 35),
  ];

  it("shows every reached requester-facing production stage", () => {
    const timeline = service.buildStatusTimeline([], completeJourney);

    expect(timeline.map((entry) => entry.label)).toEqual(
      PIPELINE_PHASES.map((phase) => phase.label)
    );
  });

  it("deduplicates retries and repeated per-scene transitions", () => {
    const timeline = service.buildStatusTimeline([], [
      ...completeJourney.slice(0, 4),
      stepEntry("scene-retry", VideoGenerationStep.GeneratingBaseVideo, 16),
      stepEntry("scene-review", VideoGenerationStep.AwaitingVideoApproval, 17),
      ...completeJourney.slice(4),
    ]);

    expect(timeline).toHaveLength(8);
    expect(
      timeline.filter((entry) => entry.label === PIPELINE_PHASES[3].label)
    ).toHaveLength(1);
  });

  it("adds the current phase when its best-effort history write is missing", () => {
    const currentAt = new Date(Date.UTC(2026, 6, 28, 6, 40));
    const timeline = service.buildStatusTimeline(
      [],
      completeJourney.slice(0, 7),
      VideoGenerationStep.AwaitingDistributionReview,
      currentAt
    );

    expect(timeline.map((entry) => entry.label)).toEqual(
      PIPELINE_PHASES.map((phase) => phase.label)
    );
    expect(timeline.at(-1)?.changedAt).toEqual(currentAt);
  });

  it("places Delivered after the persisted final production milestone", () => {
    const delivered = statusEntry("delivered", RequestStatus.Delivered, 110);
    const finalStage = stepEntry(
      "distribution-ready",
      VideoGenerationStep.AwaitingDistributionReview,
      40
    );
    const timeline = service.buildStatusTimeline([delivered], [
      ...completeJourney.slice(0, 7),
      finalStage,
    ]);

    expect(timeline.at(-2)?.label).toBe(PIPELINE_PHASES[7].label);
    expect(timeline.at(-1)?.label).toBe(
      service.getStatusPresentation(RequestStatus.Delivered).label
    );
  });

  it("keeps exact job progress visible after the request is Delivered", () => {
    const progress = service.getPipelineProgress(
      RequestStatus.Delivered,
      VideoGenerationStep.AwaitingDistributionReview
    );

    expect(progress?.label).toBe("วิดีโอพร้อมดาวน์โหลดและนำไปเผยแพร่");
  });
});
