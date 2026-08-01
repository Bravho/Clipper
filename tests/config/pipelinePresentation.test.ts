import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { RenderStep, RENDER_STEP_FAILED_AT } from "@/domain/enums/RenderStep";
import {
  PIPELINE_PHASES,
  PIPELINE_STEP_PRESENTATION,
  buildPipelinePhaseDisplay,
} from "@/config/pipelinePresentation";

describe("pipeline presentation configuration", () => {
  it("covers every persisted VideoGenerationStep exhaustively", () => {
    expect(Object.keys(PIPELINE_STEP_PRESENTATION).sort()).toEqual(
      Object.values(VideoGenerationStep).sort()
    );
  });

  it("defines the complete eight-stage requester journey", () => {
    expect(PIPELINE_PHASES).toHaveLength(8);
    expect(PIPELINE_PHASES.map((phase) => phase.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it.each(
    Object.values(VideoGenerationStep).filter(
      (step) => step !== VideoGenerationStep.Failed
    )
  )("projects %s into exactly one correct current phase", (step) => {
    const presentation = PIPELINE_STEP_PRESENTATION[step];
    const display = buildPipelinePhaseDisplay(step);

    expect(presentation.phaseId).not.toBeNull();

    if (presentation.state === "complete") {
      expect(display.every(({ status }) => status === "completed")).toBe(true);
      return;
    }

    const current = display.filter(
      ({ status }) => status !== "completed" && status !== "pending"
    );
    expect(current).toHaveLength(1);
    expect(current[0].phase.id).toBe(presentation.phaseId);
    expect(current[0].status).toBe(presentation.state);

    for (const item of display) {
      if (item.phase.id < presentation.phaseId!) {
        expect(item.status).toBe("completed");
      }
      if (item.phase.id > presentation.phaseId!) {
        expect(item.status).toBe("pending");
      }
    }
  });

  it("shows distribution review as ready with all prior stages complete", () => {
    const display = buildPipelinePhaseDisplay(
      VideoGenerationStep.AwaitingDistributionReview
    );

    expect(display.slice(0, 7).every(({ status }) => status === "completed")).toBe(
      true
    );
    expect(display[7].status).toBe("ready");
  });

  it("shows Complete as all stages completed", () => {
    expect(
      buildPipelinePhaseDisplay(VideoGenerationStep.Complete).every(
        ({ status }) => status === "completed"
      )
    ).toBe(true);
  });

  it("marks the exact failed phase and leaves later phases pending", () => {
    const display = buildPipelinePhaseDisplay(
      VideoGenerationStep.Failed,
      VideoGenerationStep.MergingScenes
    );

    expect(display.slice(0, 4).every(({ status }) => status === "completed")).toBe(
      true
    );
    expect(display[4].status).toBe("failed");
    expect(display.slice(5).every(({ status }) => status === "pending")).toBe(true);
  });

  it("attributes a montage-merge render failure to the merge phase", () => {
    expect(RENDER_STEP_FAILED_AT[RenderStep.MontageMerge]).toBe(
      VideoGenerationStep.MergingScenes
    );
  });

  it("keeps the package preview visually distinct from a tracked job", () => {
    expect(
      buildPipelinePhaseDisplay().every(({ status }) => status === "preview")
    ).toBe(true);
  });
});
