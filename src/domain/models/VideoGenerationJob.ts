import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

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

  // Step 1: ChatGPT Vision outputs
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

  // Step 3: AI base video (Google Veo 3.1 Lite), PER-SCENE (Phase 3 / "Phase
  // 2" of the audio-first plan). `job.voiceDurationSeconds` is split across
  // `approvedScenePlan`/`scenePlan` scenes proportionally to each scene's
  // original estimated `durationSeconds`, and one video-generation call is
  // issued per scene using that scene's `visualDescriptionThai` + images
  // selected via `imageIndexes`. Field names are provider-neutral so the
  // underlying generator can be swapped without further model changes.
  /**
   * JSON-encoded `string[]` — one provider task/operation ID per scene, in
   * scene order. Replaces the old single `videoGenTaskId` (kept below for
   * DB/legacy compat and as a quick "any task in flight" signal, but no longer
   * the source of truth once N > 1).
   */
  videoGenTaskIds: string[] | null;
  /** @deprecated Phase 3 — superseded by videoGenTaskIds. Kept for DB/legacy compat. */
  videoGenTaskId: string | null;
  videoGenStatus: "submitted" | "processing" | null;
  videoGenLastPolledAt: Date | null;
  /**
   * Per-scene generated output assets, in scene order, before concatenation.
   * JSON-encoded `string[]` of UploadedAsset IDs (AssetType.AIGeneratedBaseVideo).
   * While polling is in progress this array may be "sparse" — entries for
   * scenes whose generation task hasn't completed yet are `null` placeholders
   * (same length as `videoGenTaskIds`) so `checkBaseVideoReady` can resume
   * polling only the still-pending scenes. Once all scenes are ready this
   * holds the final `string[]` with no nulls.
   */
  sceneVideoAssetIds: (string | null)[] | null;
  /**
   * The final, ffmpeg-concatenated video covering all scenes in order. This
   * remains the single asset that downstream steps (animation, FFmpeg
   * composition, retry logic, and the pipeline review UI) consume — kept
   * unchanged from Phase 1/2 to minimize churn. When there's only one scene,
   * this is just that scene's clip (no concat needed).
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

  // Step 4: Final exports
  finalExport_9_16_assetId: string | null;
  finalExport_16_9_assetId: string | null;
  finalExport_1_1_assetId: string | null;
  finalExport_4_5_assetId: string | null;
  /** Tvent-specific 9:16 export, always with English + Chinese subtitles. */
  finalExport_tvent_assetId: string | null;

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
  /** @deprecated kept for seed/legacy data compat. */
  visualDescription?: string;
  /** @deprecated kept for seed/legacy data compat. */
  motionNotes?: string;
  /** @deprecated kept for seed/legacy data compat. */
  motionNotesThai?: string;
}
