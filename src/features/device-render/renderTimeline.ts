import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { DeviceRenderProgress } from "@/lib/mobile/deviceRenderClient";

/**
 * What the phone is doing to make one video, as steps a person can follow.
 *
 * The phone makes a video in three parts, one after another, each rendered and
 * then sent to the request (see `docs/on-device-rendering.md`):
 *
 *   montage — the picture: shots, trims, camera moves, transitions;
 *   master  — the picture with the voice-over and the background music;
 *   final   — the finished video with the look and the captions.
 *
 * Which parts are done is read off the request's pipeline step, which only
 * moves once the server has checked a part; which one is running, and how far
 * it is, comes from the phone's own progress reports. Pure, so it is testable.
 */

export type RenderPart = "montage" | "master" | "final";

export interface RenderTimelineStep {
  id: RenderPart;
  label: string;
  detail: string;
  state: "done" | "active" | "waiting";
  /** 0-100 for the active step. */
  percent: number | null;
}

export interface RenderTimeline {
  steps: RenderTimelineStep[];
  /** 0-100 across all three parts. */
  overallPercent: number;
  /** One line saying what is happening right now. */
  status: string;
  /**
   * Where exactly the phone is inside the running part — which scene, shot and
   * clip, which caption, how far through the video — when it said.
   */
  now: string | null;
  /** Where in a part the phone is: getting ready, rendering, sending, checking. */
  activity: "preparing" | "rendering" | "uploading" | "checking" | "waiting" | "paused" | "done";
  finished: boolean;
}

const PARTS: { id: RenderPart; label: string; detail: string }[] = [
  {
    id: "montage",
    label: "Picture",
    detail: "Your shots, trims, camera moves and transitions",
  },
  {
    id: "master",
    label: "Voice and music",
    detail: "The voice-over mixed with the background music",
  },
  {
    id: "final",
    label: "Look and captions",
    detail: "The frame, decoration and captions — the finished video",
  },
];

// Pipeline steps at or past each part's completion.
const AFTER_MONTAGE: string[] = [
  VideoGenerationStep.AwaitingVideoApproval,
  VideoGenerationStep.MergingScenes,
  VideoGenerationStep.GeneratingAnimations,
  VideoGenerationStep.AwaitingAnimationApproval,
  VideoGenerationStep.ComposingFinalVideo,
];
const AFTER_MASTER: string[] = [
  VideoGenerationStep.AwaitingFinalApproval,
  VideoGenerationStep.GeneratingOverlay,
];
const AFTER_FINAL: string[] = [
  VideoGenerationStep.AwaitingOverlayApproval,
  VideoGenerationStep.AwaitingAdditionalRatios,
  VideoGenerationStep.GeneratingAdditionalRatios,
  VideoGenerationStep.AwaitingDistributionReview,
  VideoGenerationStep.Publishing,
  VideoGenerationStep.Complete,
];

function partsDone(pipelineStep: string | null): number {
  if (!pipelineStep) return 0;
  if (AFTER_FINAL.includes(pipelineStep)) return 3;
  if (AFTER_MASTER.includes(pipelineStep)) return 2;
  if (AFTER_MONTAGE.includes(pipelineStep)) return 1;
  return 0;
}

/**
 * Progress within one part, from the phone's phase reports: the render is
 * the bulk of it, then sending the file, then the server's check.
 */
export function partPercent(progress: DeviceRenderProgress | null): number {
  if (!progress) return 0;
  const p = Math.max(0, Math.min(100, progress.percent));
  switch (progress.phase) {
    case "rendering":
      return 2 + p * 0.83;
    case "uploading":
      return 85 + p * 0.1;
    case "finishing":
      return 95 + p * 0.05;
    case "done":
      return 100;
    default:
      return 1;
  }
}

export function buildRenderTimeline(input: {
  pipelineStep: string | null;
  busy: boolean;
  progress: DeviceRenderProgress | null;
  /** The phone has been asked to stop, or stopped after a problem. */
  paused: boolean;
  /** The server has a part queued for this phone right now. */
  workAvailable: boolean;
}): RenderTimeline {
  const done = partsDone(input.pipelineStep);
  const finished = done >= 3;

  // The part the phone is on: what it is rendering now if it said, otherwise
  // the first one not yet done.
  const reported = input.busy ? input.progress?.stage : undefined;
  const activeIndex = finished
    ? -1
    : reported
      ? Math.max(done, PARTS.findIndex((part) => part.id === reported))
      : done;

  const running = input.busy && input.progress != null;
  const activePercent = running ? partPercent(input.progress) : 0;

  const steps: RenderTimelineStep[] = PARTS.map((part, index) => ({
    ...part,
    state: index < done ? "done" : index === activeIndex ? "active" : "waiting",
    percent: index === activeIndex ? Math.round(activePercent) : null,
  }));

  const overallPercent = finished
    ? 100
    : Math.round(((done + (activeIndex >= 0 ? activePercent / 100 : 0)) / PARTS.length) * 100);

  let activity: RenderTimeline["activity"];
  let status: string;
  const partName = activeIndex >= 0 ? PARTS[activeIndex].label.toLowerCase() : "";
  const partNumber = activeIndex + 1;
  if (finished) {
    activity = "done";
    status = "All three parts are made. Your video is ready to watch below.";
  } else if (running) {
    switch (input.progress!.phase) {
      case "rendering":
        activity = "rendering";
        status = `Part ${partNumber} of 3 — making the ${partName} on this phone`;
        break;
      case "uploading":
        activity = "uploading";
        status = `Part ${partNumber} of 3 — sending the ${partName} to your request`;
        break;
      case "finishing":
        activity = "checking";
        status = `Part ${partNumber} of 3 — checking the file (length, picture size, sound)`;
        break;
      default:
        activity = "preparing";
        status = `Part ${partNumber} of 3 — getting your photos and clips ready`;
    }
  } else if (input.paused) {
    activity = "paused";
    status = "Paused. Tap Resume rendering to carry on from here.";
  } else if (input.workAvailable) {
    activity = "preparing";
    status = `Part ${partNumber} of 3 is ready to start on this phone…`;
  } else {
    activity = "waiting";
    status =
      done === 0
        ? "Lining up the first part…"
        : `Part ${done} of 3 is done. Lining up part ${partNumber}…`;
  }

  const now = running && input.progress!.detail ? input.progress!.detail : null;

  return { steps, overallPercent, status, now, activity, finished };
}
