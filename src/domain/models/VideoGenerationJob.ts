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

  approvedScenePlan: string | null;
  approvedScriptThai: string | null;
  approvedScriptEnglish: string | null;
  approvedHookThai: string | null;
  approvedHookEnglish: string | null;
  approvedCaptionThai: string | null;
  approvedCaptionEnglish: string | null;
  approvedCaptionChinese: string | null;

  // Step 2: Kling AI
  klingTaskId: string | null;
  klingStatus: "submitted" | "processing" | null;
  klingLastPolledAt: Date | null;
  baseVideoAssetId: string | null;

  // Step 3: iAppTTS voice generation
  /** TTS async task ID returned by the local TTS server (currently iAppTTS) - used for polling. */
  ttsTaskId: string | null;
  /** Legacy field retained for database compatibility. iAppTTS always uses its default voice. */
  rvcVoiceModel: string;
  voiceRecordingAssetId: string | null;
  processedVoiceAssetId: string | null;
  selectedMusicTrack: string | null;

  // Step 3.5: Animation generation
  subtitleTimeline: string | null;
  animationSpec: string | null;
  animatedVideoAssetId: string | null;

  // Step 4: Final exports
  finalExport_9_16_assetId: string | null;
  finalExport_16_9_assetId: string | null;
  finalExport_1_1_assetId: string | null;
  finalExport_4_5_assetId: string | null;

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
