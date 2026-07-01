import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { MotionPreset, MontageTransition } from "@/config/montage";

/**
 * Represents one AI video production pipeline run attached to a ClipRequest.
 * One job exists per production run. If a request goes back and forth through
 * pipeline steps the same job record is updated in place.
 */
export interface VideoGenerationJob {
  id: string;
  requestId: string;

  status: VideoGenerationJobStatus;
  currentStep: VideoGenerationStep;

  /**
   * 0-based index of the scene whose per-scene script gate / generation is
   * currently active. Drives the AwaitingSceneScriptApproval → GeneratingBaseVideo
   * → AwaitingVideoApproval loop: incremented when a scene's video is approved,
   * so the next scene's script gate (and its Veo extension) target the right
   * scene. Starts at 0 when the all-scenes overview is approved.
   */
  currentSceneIndex: number;

  // Step 1: ChatGPT Vision outputs
  /**
   * Rough, pre-voice storyboard generated at Stage 1 alongside the script:
   * JSON-encoded `StoryboardScene[]`. The requester approves it with the
   * script; `approvedStoryboard` then seeds the Stage-3 montage scene design
   * and is shown read-only at Stage 2. Optional/absent on legacy jobs.
   */
  storyboard?: string | null;
  approvedStoryboard?: string | null;

  /**
   * Which engine produces the base video. "montage" (default) = real-media
   * Remotion montage from the uploaded photos/clips; "veo" = generative video
   * (no-media fallback or the optional AI add-on). Absent on legacy jobs.
   */
  videoEngine?: "montage" | "veo";
  /** Whether the optional Veo "AI intro/B-roll" add-on is enabled for this job. */
  aiBrollEnabled?: boolean;

  scenePlan: string | null;
  scriptThai: string | null;
  scriptEnglish: string | null;
  hookThai: string | null;
  hookEnglish: string | null;
  captionThai: string | null;
  captionEnglish: string | null;
  captionChinese: string | null;
  /**
   * Simplified Chinese script used for subtitles. Optional: generated lazily
   * (Gemini translation) at the animation step; absent on legacy jobs.
   */
  scriptChinese?: string | null;

  approvedScenePlan: string | null;
  approvedScriptThai: string | null;
  approvedScriptEnglish: string | null;
  approvedHookThai: string | null;
  approvedHookEnglish: string | null;
  approvedCaptionThai: string | null;
  approvedCaptionEnglish: string | null;
  approvedCaptionChinese: string | null;
  /** See scriptChinese. */
  approvedScriptChinese?: string | null;

  // Step 2: ElevenLabs voice generation (now runs BEFORE video generation —
  // see VideoGenerationStep for the audio-first pipeline reorder)
  /** TTS async task ID returned by the local TTS server (currently iAppTTS) - used for polling. */
  ttsTaskId: string | null;
  /** Legacy field retained for database compatibility. iAppTTS always uses its default voice. */
  rvcVoiceModel: string;
  voiceRecordingAssetId: string | null;
  processedVoiceAssetId: string | null;
  selectedMusicTrack: string | null;
  /**
   * Real duration (seconds) of the generated voice audio, probed with
   * ffprobe immediately after ElevenLabs synthesis. This is the source of
   * truth for the video generator's `durationSeconds` (step 3) — replaces the
   * scene-plan estimate. Null until the voice step completes.
   */
  voiceDurationSeconds: number | null;
  /**
   * Per-sentence timing for the approved voice track, produced by Gemini
   * `alignAudioWithScript` immediately after voice generation (moved up
   * from the old "animation" step). JSON-encoded `TimedSegment[]` — same
   * shape `subtitleTimeline` is copied from.
   *
   * DECISION (Phase 1, plan section 4/7 — "ElevenLabs timestamps vs. Gemini
   * alignment"): the current `elevenLabsTtsService` calls the plain
   * `/v1/text-to-speech/{voice_id}` endpoint, which returns only raw audio
   * — no character/word timestamps. Switching to the
   * `/stream/with-timestamps` endpoint is a bigger change (streaming
   * response handling) than Phase 1's scope. We therefore KEEP the Gemini
   * `alignAudioWithScript` step, but RUN IT immediately after voice
   * generation (this step) instead of during the old "animation" step, so
   * `subtitleTimeline` is available before video generation and animation run.
   */
  voiceTimestamps: string | null;

  // Step 3: AI base video (Google Veo 3.1 Fast). Scene 1 is generated from
  // the approved scene data and requester images; each following scene is
  // generated only after approval by extending the previous cumulative Veo
  // output. Field names are provider-neutral so the underlying generator can
  // be swapped without further model changes.
  /**
   * JSON-encoded `string[]` - one provider task/operation ID per cumulative
   * scene generation, in scene order. Replaces the old single `videoGenTaskId`
   * (kept below for DB/legacy compat and as a quick "any task in flight"
   * signal, but no longer the source of truth once N > 1).
   */
  videoGenTaskIds: string[] | null;
  /** @deprecated Phase 3 - superseded by videoGenTaskIds. Kept for DB/legacy compat. */
  videoGenTaskId: string | null;
  videoGenStatus: "submitted" | "processing" | null;
  videoGenLastPolledAt: Date | null;
  /**
   * Cumulative generated output assets, in scene order. Entry 0 is scene 1,
   * entry 1 is scene 1+2, and so on. While polling is in progress this array
   * may contain a null placeholder for the current in-flight scene.
   */
  sceneVideoAssetIds: (string | null)[] | null;
  /**
   * The latest approved cumulative Veo video covering all generated scenes.
   * This remains the single asset that downstream steps (animation, FFmpeg
   * composition, retry logic, and the pipeline review UI) consume.
   */
  baseVideoAssetId: string | null;
  // Step 3.5: Animation generation
  /** Copied from voiceTimestamps (see above) once the voice step completes. */
  subtitleTimeline: string | null;
  animationSpec: string | null;
  /**
   * Quick composited preview asset for the `AwaitingAnimationApproval` review
   * UI — base video + one representative ratio's Remotion overlay (see
   * `animatedOverlayAssetIds`), burned together for a single-file preview.
   * Not used for final export; `_runFFmpegComposition` composites per-ratio
   * overlays directly from `animatedOverlayAssetIds` + `baseVideoAssetId`.
   */
  animatedVideoAssetId: string | null;
  /**
   * Phase 4 (Remotion-based compositing): one transparent alpha-channel
   * overlay clip (captions + scene lower-thirds) per required aspect ratio,
   * rendered by `remotionService.renderOverlay()`. Keyed by `VideoRatio`
   * string ("9:16" | "16:9" | "1:1" | "4:5") to UploadedAsset ID
   * (AssetType.AnimatedVideo). Null until `GeneratingAnimations` completes.
   */
  animatedOverlayAssetIds: Record<string, string> | null;

  /**
   * Subtitle languages the requester chose to burn into their general
   * distribution exports (any combination of "th"/"en"/"zh"). Selected when
   * approving the animation step. Defaults to ["en", "zh"].
   *
   * Independent of this, the Tvent App export (finalExport_tvent_assetId)
   * always carries English + Chinese subtitles regardless of this choice —
   * that's a Tvent platform requirement, not a requester preference.
   */
  subtitleLanguages: ("th" | "en" | "zh")[];

  // Step 4: Final exports (merged voice+music masters, per ratio — NO captions).
  // These are the un-captioned masters. The Phase-7 overlay step composites the
  // subtitle/motion-graphic layer ON TOP of these into the captionedExport_*
  // assets below, leaving the masters intact (so the Travy EN+ZH render and any
  // overlay re-render always start from a clean master).
  finalExport_9_16_assetId: string | null;
  finalExport_16_9_assetId: string | null;
  finalExport_1_1_assetId: string | null;
  finalExport_4_5_assetId: string | null;
  /** Travy (Tvent) export, always with English + Chinese subtitles. Rendered
   * automatically in the background after the overlay step is approved. */
  finalExport_tvent_assetId: string | null;

  // Step 4.5: Captioned exports (Phase 7) — the delivered videos, = the merged
  // master for that ratio with the selected-language subtitle + motion-graphic
  // overlay composited on top. Null until the overlay step renders that ratio.
  captionedExport_9_16_assetId?: string | null;
  captionedExport_16_9_assetId?: string | null;
  captionedExport_1_1_assetId?: string | null;
  captionedExport_4_5_assetId?: string | null;

  /**
   * Status of the automatic background Travy (EN+ZH) render kicked off when the
   * overlay step is approved. Drives the "generating Travy video" spinner; the
   * Travy clip (finalExport_tvent_assetId) becomes viewable once "ready". The
   * render cannot be cancelled by the requester. Absent/"idle" before approval.
   */
  tventVideoStatus?: "idle" | "generating" | "ready" | "failed" | null;

  /**
   * Motion-graphic template id (Phase 7) chosen by the requester at the
   * merged-review step, applied when the styled/captioned video is rendered.
   * "none" (default) = clean full-bleed video + subtitles only. See
   * `src/config/motionTemplates.ts`.
   */
  selectedMotionTemplate?: string | null;

  failedAtStep: VideoGenerationStep | null;

  contentApprovedBy: string | null;
  videoApprovedBy: string | null;
  voiceApprovedBy: string | null;
  animationApprovedBy: string | null;
  finalApprovedBy: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CreateVideoGenerationJobInput = Omit<
  VideoGenerationJob,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateVideoGenerationJobInput = Partial<
  Omit<VideoGenerationJob, "id" | "requestId" | "createdAt" | "updatedAt">
>;

export interface ScenePlan {
  sceneNumber: number;
  durationSeconds: number;
  visualDescriptionThai: string;
  imageIndexes: number[];
  /**
   * Real-media montage assets for this scene, in render order. Each references
   * an uploaded asset by its index in the canonical ordered source list
   * (`getOrderedSourceAssets`) and carries its motion/trim/focus. Drives the
   * Remotion montage renderer (Phase 3). Absent on legacy/Veo-only scenes.
   */
  assets?: MontageSceneAsset[];
  /** Transition into this scene within the concatenated montage. */
  transitionIn?: MontageTransition;
  /** @deprecated kept for seed/legacy data compat. */
  visualDescription?: string;
  /** @deprecated kept for seed/legacy data compat. */
  motionNotes?: string;
  /** @deprecated kept for seed/legacy data compat. */
  motionNotesThai?: string;
}

/**
 * One real-media asset within a montage scene. References an uploaded asset by
 * its index in the canonical ordered source list (`getOrderedSourceAssets`);
 * the URL is resolved at render time. `trim*` apply to clips; `focusX/Y`
 * (0..1) steer Ken Burns / crop focus toward the subject.
 */
export interface MontageSceneAsset {
  assetIndex: number;
  kind: "image" | "clip";
  motion: MotionPreset;
  durationSeconds: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  focusX?: number;
  focusY?: number;
}

/**
 * One rough storyboard scene produced at Stage 1 (pre-voice): a one-line Thai
 * summary plus the indexes of the uploaded photos/clips it will draw from
 * (indexing the canonical ordered source list). No motion presets or exact
 * timing yet — those are decided at Stage 3 against the measured voice length.
 */
export interface StoryboardScene {
  sceneNumber: number;
  summary: string;
  assetIndexes: number[];
  /** Optional pre-voice duration estimate (not binding). */
  roughDurationHint?: number;
}

/**
 * One immutable audit row recording that a job entered a given pipeline step.
 * Written on every `currentStep` transition (and on job creation) so the full
 * sequence of steps a job passed through — including each per-scene gate — is
 * preserved in the database, not just the latest `currentStep`.
 */
export interface VideoGenerationStepHistoryEntry {
  id: string;
  jobId: string;
  requestId: string;
  step: VideoGenerationStep;
  /** Active scene index at the moment of the transition (null if not applicable). */
  sceneIndex: number | null;
  createdAt: Date;
}
