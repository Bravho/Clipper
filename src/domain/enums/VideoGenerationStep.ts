export enum VideoGenerationStep {
  // Step 1 — ChatGPT Vision analysis
  AnalyzingContent        = "analyzing_content",
  AwaitingContentApproval = "awaiting_content_approval",

  // Step 2 — Kling AI video generation
  GeneratingBaseVideo     = "generating_base_video",
  AwaitingVideoApproval   = "awaiting_video_approval",

  // Step 3 — Staff voice recording + ElevenLabs conversion
  AwaitingVoiceRecording  = "awaiting_voice_recording",
  ProcessingVoice         = "processing_voice",
  AwaitingVoiceApproval   = "awaiting_voice_approval",

  // Step 4 — FFmpeg composition + multi-ratio export
  ComposingFinalVideo     = "composing_final_video",
  AwaitingFinalApproval   = "awaiting_final_approval",

  // Step 5 — Platform publishing
  Publishing              = "publishing",

  Complete                = "complete",
  Failed                  = "failed",
}

/** Steps that require polling the AI provider for async completion. */
export const POLLING_STEPS: VideoGenerationStep[] = [
  VideoGenerationStep.AnalyzingContent,
  VideoGenerationStep.GeneratingBaseVideo,
  VideoGenerationStep.ProcessingVoice,
  VideoGenerationStep.ComposingFinalVideo,
];

/** Human-readable labels for requester-facing display. */
export const PIPELINE_STEP_LABELS: Record<VideoGenerationStep, string> = {
  [VideoGenerationStep.AnalyzingContent]:        "Analyzing your content...",
  [VideoGenerationStep.AwaitingContentApproval]: "Content plan ready for review",
  [VideoGenerationStep.GeneratingBaseVideo]:     "Generating your video...",
  [VideoGenerationStep.AwaitingVideoApproval]:   "Video ready for review",
  [VideoGenerationStep.AwaitingVoiceRecording]:  "Recording voiceover",
  [VideoGenerationStep.ProcessingVoice]:         "Processing voice...",
  [VideoGenerationStep.AwaitingVoiceApproval]:   "Voice ready for review",
  [VideoGenerationStep.ComposingFinalVideo]:     "Composing final video...",
  [VideoGenerationStep.AwaitingFinalApproval]:   "Final video ready for review",
  [VideoGenerationStep.Publishing]:              "Publishing to platforms",
  [VideoGenerationStep.Complete]:                "Complete",
  [VideoGenerationStep.Failed]:                  "Production error",
};

/** One-sentence requester-facing descriptions per step. */
export const PIPELINE_STEP_DESCRIPTIONS: Record<VideoGenerationStep, string> = {
  [VideoGenerationStep.AnalyzingContent]:        "Our AI is reviewing your images and planning the scenes.",
  [VideoGenerationStep.AwaitingContentApproval]: "Our team is reviewing the AI's scene plan before production begins.",
  [VideoGenerationStep.GeneratingBaseVideo]:     "AI is generating your 15-second video from your uploaded images.",
  [VideoGenerationStep.AwaitingVideoApproval]:   "Our team is reviewing the generated video.",
  [VideoGenerationStep.AwaitingVoiceRecording]:  "Our team is recording the voiceover for your video.",
  [VideoGenerationStep.ProcessingVoice]:         "Applying professional voice enhancement.",
  [VideoGenerationStep.AwaitingVoiceApproval]:   "Our team is reviewing the final voiceover.",
  [VideoGenerationStep.ComposingFinalVideo]:     "Adding subtitles and finalizing your video in all platform formats.",
  [VideoGenerationStep.AwaitingFinalApproval]:   "Our team is doing the final quality check.",
  [VideoGenerationStep.Publishing]:              "Your video is being published to selected platforms.",
  [VideoGenerationStep.Complete]:                "Your video has been published successfully.",
  [VideoGenerationStep.Failed]:                  "A production issue occurred. Our team is investigating.",
};
