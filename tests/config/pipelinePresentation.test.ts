import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { RenderStep, RENDER_STEP_FAILED_AT } from "@/domain/enums/RenderStep";
import {
  PIPELINE_PHASES,
  PIPELINE_STEP_PRESENTATION,
  buildPipelinePhaseDisplay,
  getPipelineStepPresentation,
  isAutoApprovedGate,
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

  // ── Express lane ("approve everything from here", chosen at the scene-video
  //    review) ────────────────────────────────────────────────────────────────
  describe("express lane display", () => {
    const AUTO_GATES = [
      // The lane starts at scene-plan approval, so the per-scene video review and
      // the merge-and-music gate are passed through too — they must read as work
      // in progress like the rest.
      VideoGenerationStep.AwaitingVideoApproval,
      VideoGenerationStep.AwaitingAnimationApproval,
      VideoGenerationStep.AwaitingFinalApproval,
      VideoGenerationStep.AwaitingOverlayApproval,
      VideoGenerationStep.AwaitingAdditionalRatios,
    ];

    it("does not swallow the gate the requester actually acts on", () => {
      // Scene-plan approval is where the lane is CHOSEN, so it must keep asking
      // for a click even on a job that later runs itself.
      const step = VideoGenerationStep.AwaitingSceneDesignApproval;
      expect(isAutoApprovedGate(step)).toBe(false);
      expect(getPipelineStepPresentation(step, { autoApproveRemaining: true })).toEqual(
        PIPELINE_STEP_PRESENTATION[step]
      );
    });

    it.each(AUTO_GATES)(
      "%s shows as work in progress, not as waiting for the requester",
      (step) => {
        // Default: this gate is genuinely waiting on a click.
        expect(PIPELINE_STEP_PRESENTATION[step].state).toBe("action_required");
        expect(isAutoApprovedGate(step)).toBe(true);

        const auto = getPipelineStepPresentation(step, { autoApproveRemaining: true })!;
        expect(auto.state).toBe("processing");
        // …and the copy must not tell them to do something.
        expect(auto.statusLabel).not.toBe(PIPELINE_STEP_PRESENTATION[step].statusLabel);
        expect(auto.statusLabel).toContain("อัตโนมัติ");
        // The phase it belongs to is unchanged — only how it reads.
        expect(auto.phaseId).toBe(PIPELINE_STEP_PRESENTATION[step].phaseId);

        const display = buildPipelinePhaseDisplay(step, null, {
          autoApproveRemaining: true,
        });
        expect(
          display.find(({ phase }) => phase.id === auto.phaseId)?.status
        ).toBe("processing");
      }
    );

    it("leaves the download gate alone — it still needs the requester", () => {
      const step = VideoGenerationStep.AwaitingDistributionReview;
      expect(isAutoApprovedGate(step)).toBe(false);
      expect(getPipelineStepPresentation(step, { autoApproveRemaining: true })).toEqual(
        PIPELINE_STEP_PRESENTATION[step]
      );
    });

    it("changes nothing for a job that did not take the express lane", () => {
      for (const step of AUTO_GATES) {
        expect(getPipelineStepPresentation(step)).toEqual(
          PIPELINE_STEP_PRESENTATION[step]
        );
        expect(buildPipelinePhaseDisplay(step, null)).toEqual(
          buildPipelinePhaseDisplay(step, null, { autoApproveRemaining: false })
        );
      }
    });
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
