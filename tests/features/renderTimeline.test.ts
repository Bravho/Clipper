/**
 * The Render step's live progress: three parts, made one after another on the
 * phone, with a percentage and a sentence saying what is happening.
 */

import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { buildRenderTimeline, partPercent } from "@/features/device-render/renderTimeline";

const idle = { busy: false, progress: null, paused: false, workAvailable: false };

describe("render timeline", () => {
  it("starts on the picture with nothing done", () => {
    const timeline = buildRenderTimeline({
      ...idle,
      pipelineStep: VideoGenerationStep.GeneratingBaseVideo,
    });
    expect(timeline.steps.map((step) => step.state)).toEqual(["active", "waiting", "waiting"]);
    expect(timeline.overallPercent).toBe(0);
    expect(timeline.status).toMatch(/Lining up the first part/);
  });

  it("shows the phone's own percentage for the part it is making", () => {
    const timeline = buildRenderTimeline({
      pipelineStep: VideoGenerationStep.ComposingFinalVideo,
      busy: true,
      progress: { phase: "rendering", percent: 50, message: "", stage: "master", ratio: "9:16" },
      paused: false,
      workAvailable: false,
    });
    expect(timeline.steps.map((step) => step.state)).toEqual(["done", "active", "waiting"]);
    const active = timeline.steps[1];
    expect(active.percent).toBe(Math.round(partPercent({ phase: "rendering", percent: 50, message: "" })));
    expect(timeline.overallPercent).toBeGreaterThan(33);
    expect(timeline.overallPercent).toBeLessThan(67);
    expect(timeline.status).toMatch(/Part 2 of 3 — making the voice and music on this phone/);
  });

  it("says when it is sending and checking a part", () => {
    const uploading = buildRenderTimeline({
      pipelineStep: VideoGenerationStep.GeneratingOverlay,
      busy: true,
      progress: { phase: "uploading", percent: 10, message: "", stage: "final" },
      paused: false,
      workAvailable: false,
    });
    expect(uploading.activity).toBe("uploading");
    expect(uploading.status).toMatch(/sending/);
    const checking = buildRenderTimeline({
      pipelineStep: VideoGenerationStep.GeneratingOverlay,
      busy: true,
      progress: { phase: "finishing", percent: 50, message: "", stage: "final" },
      paused: false,
      workAvailable: false,
    });
    expect(checking.activity).toBe("checking");
  });

  it("says it is paused after Stop", () => {
    const timeline = buildRenderTimeline({
      ...idle,
      pipelineStep: VideoGenerationStep.AwaitingFinalApproval,
      paused: true,
    });
    expect(timeline.activity).toBe("paused");
    expect(timeline.steps.map((step) => step.state)).toEqual(["done", "done", "active"]);
  });

  it("is finished once the video is ready to review", () => {
    const timeline = buildRenderTimeline({
      ...idle,
      pipelineStep: VideoGenerationStep.AwaitingOverlayApproval,
    });
    expect(timeline.finished).toBe(true);
    expect(timeline.overallPercent).toBe(100);
    expect(timeline.steps.every((step) => step.state === "done")).toBe(true);
  });

  it("never runs a part's percentage backwards across phases", () => {
    const values = [
      partPercent({ phase: "rendering", percent: 0, message: "" }),
      partPercent({ phase: "rendering", percent: 100, message: "" }),
      partPercent({ phase: "uploading", percent: 0, message: "" }),
      partPercent({ phase: "uploading", percent: 100, message: "" }),
      partPercent({ phase: "finishing", percent: 100, message: "" }),
    ];
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(values[values.length - 1]).toBe(100);
  });

  it("passes on exactly where the phone is inside the running part", () => {
    const running = buildRenderTimeline({
      ...idle,
      pipelineStep: null,
      busy: true,
      progress: {
        phase: "rendering",
        percent: 40,
        message: "",
        stage: "final",
        detail: "Editorial look · caption 3 of 7 · 0:09 of 0:24",
      },
    });
    expect(running.now).toBe("Editorial look · caption 3 of 7 · 0:09 of 0:24");
    expect(buildRenderTimeline({ ...idle, pipelineStep: null }).now).toBeNull();
  });
});
