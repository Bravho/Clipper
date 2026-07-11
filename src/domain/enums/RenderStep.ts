import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

/**
 * The heavy compute steps that can be offloaded to the Mac Mini render worker.
 *
 * Each value names a single unit of work the worker claims and runs by calling
 * `VideoGenerationService.runQueuedRenderStep(job)`, which dispatches back to the
 * EXISTING private compute method — no compute is reimplemented on the worker.
 *
 * Only FFmpeg/Remotion-heavy steps are here. AI-API steps (ChatGPT analysis,
 * ElevenLabs TTS, Gemini scene design) stay inline on the web server — they are
 * network-bound, not CPU/GPU-bound, so there is nothing to offload.
 */
export enum RenderStep {
  /** Render one montage scene segment (`_renderSceneSegment`, needs sceneIndex). */
  MontageSceneSegment = "montage_scene_segment",
  /** Render every scene segment sequentially (`_renderAllSceneSegments`). */
  MontageAllSegments = "montage_all_segments",
  /** Merge approved scene segments into the base video (`_runMontageMerge`). */
  MontageMerge = "montage_merge",
  /** Remotion animation/overlay generation (`_runAnimationGeneration`). */
  AnimationGeneration = "animation_generation",
  /** FFmpeg composition + multi-ratio export (`_runFFmpegComposition`). */
  FfmpegComposition = "ffmpeg_composition",
  /** Phase-7 subtitle/motion overlay render (`_runOverlayComposition`). */
  OverlayComposition = "overlay_composition",
  /** Remaining aspect-ratio overlay renders (`_runAdditionalRatiosOverlay`). */
  AdditionalRatios = "additional_ratios",
  /**
   * Automatic Travy (EN+ZH) captioned render (`_runTventVideoGeneration`).
   * Only used on the no-additional-ratios path, where the finalize runs in a web
   * request (not inside a worker claim) and so can safely enqueue this as its own
   * supervised step. On the additional-ratios path the Travy clip is rendered
   * inline within `_runAdditionalRatiosOverlay` instead (already on the worker).
   * This step is soft-failing: `_runTventVideoGeneration` never throws — a Travy
   * failure only sets `tventVideoStatus = "failed"`, it does NOT fail the pipeline
   * (the other channels are already delivered).
   */
  TventGeneration = "tvent_generation",
}

/**
 * The `failedAtStep` (a pipeline `VideoGenerationStep`) to record if a given
 * render step throws — mirrors the value each inline `.catch` handler used
 * before the seam existed, so failure/retry semantics are unchanged whether the
 * step ran inline or on the worker.
 */
export const RENDER_STEP_FAILED_AT: Record<RenderStep, VideoGenerationStep> = {
  [RenderStep.MontageSceneSegment]: VideoGenerationStep.GeneratingBaseVideo,
  [RenderStep.MontageAllSegments]: VideoGenerationStep.GeneratingBaseVideo,
  [RenderStep.MontageMerge]: VideoGenerationStep.GeneratingBaseVideo,
  [RenderStep.AnimationGeneration]: VideoGenerationStep.GeneratingAnimations,
  [RenderStep.FfmpegComposition]: VideoGenerationStep.ComposingFinalVideo,
  [RenderStep.OverlayComposition]: VideoGenerationStep.GeneratingOverlay,
  [RenderStep.AdditionalRatios]: VideoGenerationStep.GeneratingAdditionalRatios,
  // Soft-failing step: never throws, so this mapping is only for type
  // completeness. The pipeline is NOT failed on a Travy error.
  [RenderStep.TventGeneration]: VideoGenerationStep.AwaitingDistributionReview,
};

/** Runtime type guard for values coming back from the database. */
export function isRenderStep(value: unknown): value is RenderStep {
  return (
    typeof value === "string" &&
    (Object.values(RenderStep) as string[]).includes(value)
  );
}
