import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  uploadedAssetRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { AI_CONFIG } from "@/config/aiTools";
import { generateScenePlanAndScript } from "@/lib/ai/chatGptVisionService";

/**
 * POST /api/requests/[id]/analyze
 *
 * Runs Gemini Vision on the request's uploaded images and returns a
 * scene plan, scripts, hooks, and captions. Called immediately after
 * submission so the requester sees the AI output right away.
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
  const imageUrls = assets
    .filter(
      (a) =>
        (a.assetType === AssetType.Image || a.assetType === AssetType.Video) &&
        a.uploadStatus === AssetUploadStatus.Uploaded
    )
    .map((a) => a.storageUrl)
    .filter((url): url is string => Boolean(url));

  try {
    const analysis = await generateScenePlanAndScript({
      imageUrls,
      description: clipRequest.description,
      targetAudience: clipRequest.targetAudience,
      targetPlatforms: clipRequest.targetPlatforms,
      preferredStyle: clipRequest.preferredStyle ?? "",
    });

    // Persist the analysis in a VideoGenerationJob so it survives navigation.
    // Only create if no job exists yet (idempotent on retry).
    const existingJob = await videoGenerationJobRepository.findByRequestId(id);
    if (!existingJob) {
      await videoGenerationJobRepository.create({
        requestId: id,
        status: VideoGenerationJobStatus.Active,
        currentStep: VideoGenerationStep.AwaitingContentApproval,
        scenePlan: JSON.stringify(analysis.scenePlan),
        scriptThai: analysis.scriptThai,
        scriptEnglish: null,
        hookThai: analysis.hookThai,
        hookEnglish: null,
        captionThai: analysis.captionThai,
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
        klingTaskId: null,
        baseVideoAssetId: null,
        rvcVoiceModel: "",
        voiceRecordingAssetId: null,
        processedVoiceAssetId: null,
        selectedMusicTrack: null,
        finalExport_9_16_assetId: null,
        finalExport_16_9_assetId: null,
        finalExport_1_1_assetId: null,
        finalExport_4_5_assetId: null,
        failedAtStep: null,
        contentApprovedBy: null,
        videoApprovedBy: null,
        voiceApprovedBy: null,
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
