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

  // Step 2.75 - Per-scene script gate. After the all-scenes overview is
  // approved, the requester reviews/edits each scene's script + media
  // selection individually right before that scene is built. The pipeline
  // loops between this gate and GeneratingBaseVideo/AwaitingVideoApproval once
  // per scene (montage engine — each scene renders one real-media segment that
  // is concatenated into the base video after the last scene is approved).
  AwaitingSceneScriptApproval = "awaiting_scene_script_approval",

  // Step 3 - Real-media montage render, sized to the real voice duration.
  GeneratingBaseVideo     = "generating_base_video",
  AwaitingVideoApproval   = "awaiting_video_approval",

  // Step 3.5 - Animation/graphic overlays synced to the voice timeline.
  GeneratingAnimations    = "generating_animations",
  AwaitingAnimationApproval = "awaiting_animation_approval",

  // Step 4 - FFmpeg composition + multi-ratio export.
  ComposingFinalVideo     = "composing_final_video",
  AwaitingFinalApproval   = "awaiting_final_approval",

  // Step 4.5 - Subtitle + motion-graphic overlay (Phase 7). After the merged
  // voice+music video is approved (and the requester has chosen subtitle
  // languages), a transparent Remotion overlay (captions in the selected
  // languages + motion graphics) is rendered and composited ON TOP of the
  // primary-ratio merged master into a playable captioned preview. The
  // requester reviews/approves that; if more than one distribution ratio is
  // required, they then trigger generation of the remaining ratios, after
  // which the Travy (EN+ZH) export is rendered automatically in the background.
  GeneratingOverlay          = "generating_overlay",
  AwaitingOverlayApproval    = "awaiting_overlay_approval",
  AwaitingAdditionalRatios   = "awaiting_additional_ratios",
  GeneratingAdditionalRatios = "generating_additional_ratios",

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
  VideoGenerationStep.GeneratingOverlay,
  VideoGenerationStep.GeneratingAdditionalRatios,
];

/** Human-readable labels for requester-facing display. */
export const PIPELINE_STEP_LABELS: Record<VideoGenerationStep, string> = {
  [VideoGenerationStep.AnalyzingContent]:          "Writing speaking script...",
  [VideoGenerationStep.AwaitingContentApproval]:   "Speaking script ready for review",
  [VideoGenerationStep.GeneratingVoice]:            "Generating AI voiceover...",
  [VideoGenerationStep.AwaitingVoiceApproval]:      "Voiceover ready for review",
  [VideoGenerationStep.GeneratingSceneDesign]:      "Writing video script and scene plan...",
  [VideoGenerationStep.AwaitingSceneDesignApproval]: "Video script ready for review",
  [VideoGenerationStep.AwaitingSceneScriptApproval]: "Scene ready for review",
  [VideoGenerationStep.GeneratingBaseVideo]:        "Building your video from your photos and clips...",
  [VideoGenerationStep.AwaitingVideoApproval]:      "Scene clip ready for review",
  [VideoGenerationStep.GeneratingAnimations]:       "Generating animations...",
  [VideoGenerationStep.AwaitingAnimationApproval]:  "Animation ready for review",
  [VideoGenerationStep.ComposingFinalVideo]:        "Composing final video...",
  [VideoGenerationStep.AwaitingFinalApproval]:      "Merged video ready for review",
  [VideoGenerationStep.GeneratingOverlay]:          "Adding subtitles and motion graphics...",
  [VideoGenerationStep.AwaitingOverlayApproval]:    "Subtitled video ready for review",
  [VideoGenerationStep.AwaitingAdditionalRatios]:   "Ready to generate other channel formats",
  [VideoGenerationStep.GeneratingAdditionalRatios]: "Generating other channel formats...",
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
  [VideoGenerationStep.AwaitingSceneScriptApproval]: "Review and edit this scene's media, motion, and script before it is built.",
  [VideoGenerationStep.GeneratingBaseVideo]:        "Building this scene from your photos and clips, timed to match your approved voiceover.",
  [VideoGenerationStep.AwaitingVideoApproval]:      "Your scene clip is ready - please review and approve.",
  [VideoGenerationStep.GeneratingAnimations]:       "AI is adding animations and graphic overlays synced to your voiceover.",
  [VideoGenerationStep.AwaitingAnimationApproval]:  "Your animated video is ready - please review and approve.",
  [VideoGenerationStep.ComposingFinalVideo]:        "Merging your voiceover and background music into the video.",
  [VideoGenerationStep.AwaitingFinalApproval]:      "Your merged video is ready - review it and choose subtitle languages before captions are added.",
  [VideoGenerationStep.GeneratingOverlay]:          "Adding your subtitles and motion graphics on top of the video.",
  [VideoGenerationStep.AwaitingOverlayApproval]:    "Your subtitled video is ready - please review and approve.",
  [VideoGenerationStep.AwaitingAdditionalRatios]:   "Generate the remaining aspect ratios for your other distribution channels.",
  [VideoGenerationStep.GeneratingAdditionalRatios]: "Generating subtitled videos for your other distribution channels.",
  [VideoGenerationStep.Publishing]:                 "Your video is being published to selected platforms.",
  [VideoGenerationStep.Complete]:                   "Your video has been published successfully.",
  [VideoGenerationStep.Failed]:                     "A production issue occurred. Please check the details below.",
  [VideoGenerationStep.AwaitingVoiceRecording]:     "Recording your voiceover.",
  [VideoGenerationStep.ProcessingVoice]:            "Applying professional voice enhancement.",
};
