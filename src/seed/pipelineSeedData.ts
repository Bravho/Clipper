/**
 * Seed data for VideoGenerationJob and VideoPublishRecord.
 *
 * Provides baseline pipeline records that survive dev server restarts,
 * so staff can always test the pipeline UI without re-creating data.
 *
 * Seeded jobs:
 *   job-004  req-004  Failed at AnalyzingContent  (test retry flow)
 *   job-011  req-011  AwaitingContentApproval      (test approval flow)
 */

import { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

function d(iso: string): Date {
  return new Date(iso);
}

export const SEED_PIPELINE_JOBS: VideoGenerationJob[] = [
  // ── job-004: Failed — req-004 in Editing, pipeline failed at Gemini analysis ──
  {
    id: "job-004",
    requestId: "req-004",
    status: VideoGenerationJobStatus.Failed,
    currentStep: VideoGenerationStep.Failed,
    failedAtStep: VideoGenerationStep.AnalyzingContent,

    scenePlan: null,
    scriptThai: null,
    scriptEnglish: null,
    hookThai: null,
    hookEnglish: null,
    captionThai: null,
    captionEnglish: null,
    captionChinese: null,
    approvedScenePlan: null,
    approvedScriptThai: null,
    approvedScriptEnglish: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,

    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: null,    ttsTaskId: null,

    rvcVoiceModel: "",
    voiceRecordingAssetId: null,
    processedVoiceAssetId: null,
    selectedMusicTrack: null,
    voiceDurationSeconds: null,
    voiceTimestamps: null,
    subtitleLanguages: ["en", "zh"],
    finalExport_9_16_assetId: null,
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_tvent_assetId: null,

    subtitleTimeline: null,
    animationSpec: null,
    animatedVideoAssetId: null,
    animatedOverlayAssetIds: null,
    contentApprovedBy: null,
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,

    createdAt: d("2026-05-03T10:00:00Z"),
    updatedAt: d("2026-05-03T10:01:00Z"),
  },

  // ── job-011: AwaitingContentApproval — req-011 in Editing, Gemini succeeded ──
  {
    id: "job-011",
    requestId: "req-011",
    status: VideoGenerationJobStatus.Active,
    currentStep: VideoGenerationStep.AwaitingContentApproval,
    failedAtStep: null,

    scenePlan: JSON.stringify([
      {
        sceneNumber: 1,
        durationSeconds: 5,
        visualDescription: "Close-up of a wellness journal open on a wooden desk, soft morning light",
        imageIndexes: [0],
        motionNotes: "Slow zoom in",
      },
      {
        sceneNumber: 2,
        durationSeconds: 7,
        visualDescription: "Hand writing in the journal, tea cup beside it, blurred background",
        imageIndexes: [0],
        motionNotes: "Pan left to right",
      },
      {
        sceneNumber: 3,
        durationSeconds: 3,
        visualDescription: "The journal closes, person smiles at camera",
        imageIndexes: [0],
        motionNotes: "Pull back wide shot",
      },
    ]),
    scriptThai:
      "เริ่มต้นวันใหม่ด้วยการจดบันทึกความคิด สร้างสุขภาพจิตที่ดีได้ง่ายๆ ทุกวัน ลองเริ่มวันนี้เลย",
    scriptEnglish:
      "Start each day by journaling your thoughts. Build better mental health easily, every day. Try it today.",
    hookThai: "คุณเริ่มต้นวันอย่างไร?",
    hookEnglish: "How do you start your day?",
    captionThai:
      "🌿 เริ่มต้นวันใหม่ด้วยการจดบันทึก สร้างสุขภาพจิตที่ดี #สุขภาพจิต #journaling #เช้านี้",
    captionEnglish:
      "🌿 Start your day with journaling for better mental health. #MentalHealth #JournalingLife #MorningRoutine",
    captionChinese:
      "🌿 每天写日记，从内心开始关爱自己。#心理健康 #写日记 #早晨习惯",

    approvedScenePlan: null,
    approvedScriptThai: null,
    approvedScriptEnglish: null,
    approvedHookThai: null,
    approvedHookEnglish: null,
    approvedCaptionThai: null,
    approvedCaptionEnglish: null,
    approvedCaptionChinese: null,

    videoGenTaskId: null,
    videoGenTaskIds: null,
    videoGenStatus: null,
    videoGenLastPolledAt: null,
    sceneVideoAssetIds: null,
    baseVideoAssetId: null,    ttsTaskId: null,

    rvcVoiceModel: "",
    voiceRecordingAssetId: null,
    processedVoiceAssetId: null,
    selectedMusicTrack: null,
    voiceDurationSeconds: null,
    voiceTimestamps: null,
    subtitleLanguages: ["en", "zh"],
    finalExport_9_16_assetId: null,
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_tvent_assetId: null,

    subtitleTimeline: null,
    animationSpec: null,
    animatedVideoAssetId: null,
    animatedOverlayAssetIds: null,
    contentApprovedBy: null,
    videoApprovedBy: null,
    voiceApprovedBy: null,
    animationApprovedBy: null,
    finalApprovedBy: null,

    createdAt: d("2026-05-03T11:00:00Z"),
    updatedAt: d("2026-05-03T11:05:00Z"),
  },
];
