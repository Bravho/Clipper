export enum VideoGenerationStep {
  // Step 1 - Generate and approve the speaking script.
  AnalyzingContent        = "analyzing_content",
  AwaitingContentApproval = "awaiting_content_approval",

  // Step 2 - iAppTTS voice generation from the approved script.
  GeneratingVoice         = "generating_voice",
  AwaitingVoiceApproval   = "awaiting_voice_approval",

  // Step 2.5 - Scene/hook/caption design from the approved speaking script
  // plus requester-provided brief, profile, and uploaded media.
  GeneratingSceneDesign   = "generating_scene_design",
  AwaitingSceneDesignApproval = "awaiting_scene_design_approval",

  // Step 3 - Kling AI video generation, sized to the real voice duration.
  GeneratingBaseVideo     = "generating_base_video",
  AwaitingVideoApproval   = "awaiting_video_approval",

  // Step 3.5 - Animation/graphic overlays synced to the voice timeline.
  GeneratingAnimations    = "generating_animations",
  AwaitingAnimationApproval = "awaiting_animation_approval",

  // Step 4 - FFmpeg composition + multi-ratio export.
  ComposingFinalVideo     = "composing_final_video",
  AwaitingFinalApproval   = "awaiting_final_approval",

  // Step 5 - Platform publishing.
  Publishing              = "publishing",

  Complete                = "complete",
  Failed                  = "failed",

  // Legacy - kept so existing DB rows with these values don't break.
  AwaitingVoiceRecording  = "awaiting_voice_recording",
  ProcessingVoice         = "processing_voice",
}

/** Steps where the page should poll for async progress and refresh on changes. */
export const POLLING_STEPS: VideoGenerationStep[] = [
  VideoGenerationStep.AnalyzingContent,
  VideoGenerationStep.GeneratingVoice,
  VideoGenerationStep.GeneratingSceneDesign,
  VideoGenerationStep.GeneratingBaseVideo,
  VideoGenerationStep.GeneratingAnimations,
  VideoGenerationStep.ComposingFinalVideo,
];

/** Human-readable labels for requester-facing display. */
export const PIPELINE_STEP_LABELS: Record<VideoGenerationStep, string> = {
  [VideoGenerationStep.AnalyzingContent]:          "Writing speaking script...",
  [VideoGenerationStep.AwaitingContentApproval]:   "Speaking script ready for review",
  [VideoGenerationStep.GeneratingVoice]:            "Generating AI voiceover...",
  [VideoGenerationStep.AwaitingVoiceApproval]:      "Voiceover ready for review",
  [VideoGenerationStep.GeneratingSceneDesign]:      "Writing video script and scene plan...",
  [VideoGenerationStep.AwaitingSceneDesignApproval]: "Video script ready for review",
  [VideoGenerationStep.GeneratingBaseVideo]:        "Generating your video...",
  [VideoGenerationStep.AwaitingVideoApproval]:      "Video ready for review",
  [VideoGenerationStep.GeneratingAnimations]:       "Generating animations...",
  [VideoGenerationStep.AwaitingAnimationApproval]:  "Animation ready for review",
  [VideoGenerationStep.ComposingFinalVideo]:        "Composing final video...",
  [VideoGenerationStep.AwaitingFinalApproval]:      "Final video ready for review",
  [VideoGenerationStep.Publishing]:                 "Publishing to platforms",
  [VideoGenerationStep.Complete]:                   "Complete",
  [VideoGenerationStep.Failed]:                     "Production error",
  [VideoGenerationStep.AwaitingVoiceRecording]:     "Recording voiceover",
  [VideoGenerationStep.ProcessingVoice]:            "Processing voice...",
};

/** One-sentence requester-facing descriptions per step. */
export const PIPELINE_STEP_DESCRIPTIONS: Record<VideoGenerationStep, string> = {
  [VideoGenerationStep.AnalyzingContent]:          "AI is reviewing your request and writing the Thai speaking script.",
  [VideoGenerationStep.AwaitingContentApproval]:   "Please review the speaking script before AI voice generation begins.",
  [VideoGenerationStep.GeneratingVoice]:            "AI is generating a Thai voiceover from your approved script.",
  [VideoGenerationStep.AwaitingVoiceApproval]:      "Your AI voiceover is ready - please listen and approve.",
  [VideoGenerationStep.GeneratingSceneDesign]:      "AI is writing the video scene plan from the approved voiceover length and your request details.",
  [VideoGenerationStep.AwaitingSceneDesignApproval]: "Please review the video script and scene timing before video generation begins.",
  [VideoGenerationStep.GeneratingBaseVideo]:        "AI is generating your video from your uploaded images, timed to match your approved voiceover.",
  [VideoGenerationStep.AwaitingVideoApproval]:      "Your AI-generated video is ready - please review and approve.",
  [VideoGenerationStep.GeneratingAnimations]:       "AI is adding animations and graphic overlays synced to your voiceover.",
  [VideoGenerationStep.AwaitingAnimationApproval]:  "Your animated video is ready - please review and approve.",
  [VideoGenerationStep.ComposingFinalVideo]:        "Adding subtitles and finalizing your video in all platform formats.",
  [VideoGenerationStep.AwaitingFinalApproval]:      "Your final video is ready - please review and approve.",
  [VideoGenerationStep.Publishing]:                 "Your video is being published to selected platforms.",
  [VideoGenerationStep.Complete]:                   "Your video has been published successfully.",
  [VideoGenerationStep.Failed]:                     "A production issue occurred. Please check the details below.",
  [VideoGenerationStep.AwaitingVoiceRecording]:     "Recording your voiceover.",
  [VideoGenerationStep.ProcessingVoice]:            "Applying professional voice enhancement.",
};
