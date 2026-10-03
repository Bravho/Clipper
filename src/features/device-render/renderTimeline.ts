import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { DeviceRenderProgress } from "@/lib/mobile/deviceRenderClient";
import { studioEnglish, type StudioT } from "./studioText";

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

const PARTS: { id: RenderPart }[] = [{ id: "montage" }, { id: "master" }, { id: "final" }];

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
  /** The studio's language; English when left out. */
  t?: StudioT;
}): RenderTimeline {
  const t = input.t ?? studioEnglish;
  const pipelineDone = partsDone(input.pipelineStep);

  // The part the phone says it is on. While the phone is still sending or
  // checking a part, the server may already have moved its step past it (it
  // accepts the file before the phone hears back) — but that part is not over
  // for the person watching, and the next one has not started. So while the
  // phone is busy, ITS stage decides: everything before it is done, it is the
  // active one, and nothing after it has begun. Without this, "Look and
  // captions" lit up (showing the voice part's last few percent) before
  // "Voice and music" had finished.
  const reportedIndex =
    input.busy && input.progress?.stage
      ? PARTS.findIndex((part) => part.id === input.progress!.stage)
      : -1;
  const phoneOnIt =
    reportedIndex >= 0 && input.progress != null && input.progress.phase !== "done";
  const done = phoneOnIt ? reportedIndex : pipelineDone;
  const finished = done >= 3;

  const activeIndex = finished ? -1 : phoneOnIt ? reportedIndex : done;

  const running = input.busy && input.progress != null;
  const activePercent = running ? partPercent(input.progress) : 0;

  const steps: RenderTimelineStep[] = PARTS.map((part, index) => ({
    ...part,
    label: t(`studio.part.${part.id}`),
    detail: t(`studio.part.detail.${part.id}`),
    state: index < done ? "done" : index === activeIndex ? "active" : "waiting",
    percent: index === activeIndex ? Math.round(activePercent) : null,
  }));

  const overallPercent = finished
    ? 100
    : Math.round(((done + (activeIndex >= 0 ? activePercent / 100 : 0)) / PARTS.length) * 100);

  let activity: RenderTimeline["activity"];
  let status: string;
  const partName = activeIndex >= 0 ? t(`studio.part.${PARTS[activeIndex].id}`).toLowerCase() : "";
  const partNumber = activeIndex + 1;
  if (finished) {
    activity = "done";
    status = t("studio.timeline.allDone");
  } else if (running) {
    switch (input.progress!.phase) {
      case "rendering":
        activity = "rendering";
        status = t("studio.timeline.rendering", { n: partNumber, part: partName });
        break;
      case "uploading":
        activity = "uploading";
        status = t("studio.timeline.uploading", { n: partNumber, part: partName });
        break;
      case "finishing":
        activity = "checking";
        status = t("studio.timeline.checking", { n: partNumber });
        break;
      default:
        activity = "preparing";
        status = t("studio.timeline.preparing", { n: partNumber });
    }
  } else if (input.paused) {
    activity = "paused";
    status = t("studio.timeline.paused");
  } else if (input.workAvailable) {
    activity = "preparing";
    status = t("studio.timeline.readyToStart", { n: partNumber });
  } else {
    activity = "waiting";
    status =
      done === 0
        ? t("studio.timeline.liningUpFirst")
        : t("studio.timeline.liningUp", { done, n: partNumber });
  }

  const now = running && input.progress!.detail ? input.progress!.detail : null;

  return { steps, overallPercent, status, now, activity, finished };
}
