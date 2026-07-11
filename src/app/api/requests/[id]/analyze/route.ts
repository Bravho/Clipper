import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { generateSpeakingScript } from "@/lib/ai/chatGptVisionService";
import { orderSourceAssets } from "@/lib/sourceAssets";

/**
 * POST /api/requests/[id]/analyze
 *
 * Runs Gemini Vision on the request's uploaded images and returns a
 * speaking script and initial caption. Scene/hook design is generated later,
 * after the approved script has been converted into voice.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest || clipRequest.userId !== session.user.id) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const assets = await uploadedAssetRepository.findByRequestId(id);
  // Use the canonical ordering so storyboard asset indexes line up with the
  // StoryboardView thumbnails and the montage renderer.
  const imageUrls = orderSourceAssets(assets).map((a) => a.url);

  try {
    const scriptOutput = await generateSpeakingScript({
      imageUrls,
      title: clipRequest.title,
      description: clipRequest.description,
      targetAudience: clipRequest.targetAudience,
      targetPlatforms: clipRequest.targetPlatforms,
      preferredStyle: clipRequest.preferredStyle ?? "",
    });
    const analysis = {
      scenePlan: [],
      scriptThai: scriptOutput.scriptThai,
      hookThai: "",
      captionThai: scriptOutput.captionThai,
      theme: scriptOutput.theme,
      storyboard: scriptOutput.storyboard,
      businessProfile: scriptOutput.businessProfile,
    };

    // Persist the analysis in a VideoGenerationJob so it survives navigation.
    // Create if no job exists yet; if one exists but is still at the content-
    // approval gate (not yet started), REGENERATE its script + storyboard so
    // re-analyzing reflects the current uploads and latest generation logic.
    const existingJob = await videoGenerationJobRepository.findByRequestId(id);
    if (existingJob && existingJob.currentStep === VideoGenerationStep.AwaitingContentApproval) {
      await videoGenerationJobRepository.update(existingJob.id, {
        scriptThai: analysis.scriptThai,
        captionThai: analysis.captionThai,
        storyboard: JSON.stringify(scriptOutput.storyboard),
      });
    } else if (!existingJob) {
      await videoGenerationJobRepository.create({
        requestId: id,
        status: VideoGenerationJobStatus.Active,
        currentStep: VideoGenerationStep.AwaitingContentApproval,
        storyboard: JSON.stringify(scriptOutput.storyboard),
        approvedStoryboard: null,
        scenePlan: null,
        scriptThai: analysis.scriptThai,
        scriptEnglish: null,
        scriptChinese: null,
        hookThai: null,
        hookEnglish: null,
        captionThai: analysis.captionThai,
        captionEnglish: null,
        captionChinese: null,
        approvedScenePlan: null,
        approvedScriptThai: null,
        approvedScriptEnglish: null,
        approvedScriptChinese: null,
        approvedHookThai: null,
        approvedHookEnglish: null,
        approvedCaptionThai: null,
        approvedCaptionEnglish: null,
        approvedCaptionChinese: null,
        videoGenTaskId: null,
        videoGenStatus: null,
        videoGenLastPolledAt: null,
        baseVideoAssetId: null,    ttsTaskId: null,

        rvcVoiceModel: "",
        voiceRecordingAssetId: null,
        processedVoiceAssetId: null,
        selectedMusicTrack: null,
        voiceDurationSeconds: null,
        voiceTimestamps: null,
        videoGenTaskIds: null,
        sceneVideoAssetIds: null,
        subtitleTimeline: null,
        animationSpec: null,
        animatedVideoAssetId: null,
        animatedOverlayAssetIds: null,
        subtitleLanguages: ["en", "zh"],
        finalExport_9_16_assetId: null,
        finalExport_16_9_assetId: null,
        finalExport_1_1_assetId: null,
        finalExport_4_5_assetId: null,
        finalExport_tvent_assetId: null,
        failedAtStep: null,
        contentApprovedBy: null,
        videoApprovedBy: null,
        voiceApprovedBy: null,
        animationApprovedBy: null,
        finalApprovedBy: null,
      });
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[POST /api/requests/[id]/analyze]", err);
    const message = err instanceof Error ? err.message : "AI analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
