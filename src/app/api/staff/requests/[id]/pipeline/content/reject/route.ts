import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationJobRepository } from "@/repositories/index";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import * as chatGptVisionService from "@/lib/ai/chatGptVisionService";
import { uploadedAssetRepository, clipRequestRepository } from "@/repositories/index";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";

const schema = z.object({
  jobId: z.string().min(1),
  instructions: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const staff = await requireRole(Role.Editor, Role.Admin);
    const body = schema.parse(await req.json());

    const job = await videoGenerationJobRepository.findById(body.jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.currentStep !== VideoGenerationStep.AwaitingContentApproval) {
      return NextResponse.json({ error: "Job is not awaiting content approval" }, { status: 400 });
    }

    const updated = await videoGenerationJobRepository.update(body.jobId, {
      currentStep: VideoGenerationStep.AnalyzingContent,
      scenePlan: null,
      scriptThai: null,
      scriptEnglish: null,
      hookThai: null,
      hookEnglish: null,
      captionThai: null,
      captionEnglish: null,
      captionChinese: null,
    });

    // Re-run ChatGPT analysis asynchronously
    const request = await clipRequestRepository.findById(params.id);
    if (request) {
      const assets = await uploadedAssetRepository.findByRequestId(params.id);
      const imageUrls = assets
        .filter((a) => (a.assetType === AssetType.Image || a.assetType === AssetType.Video) && a.uploadStatus === AssetUploadStatus.Uploaded)
        .map((a) => a.storageUrl)
        .filter(Boolean);

      chatGptVisionService.generateScenePlanAndScript({
        imageUrls,
        description: body.instructions ? `${request.description}\n\nAdditional instructions: ${body.instructions}` : request.description,
        targetAudience: request.targetAudience,
        targetPlatforms: request.targetPlatforms,
        preferredStyle: request.preferredStyle,
        videoDurationSeconds: 15,
      }).then(async (output) => {
        await videoGenerationJobRepository.update(body.jobId, {
          currentStep: VideoGenerationStep.AwaitingContentApproval,
          scenePlan: JSON.stringify(output.scenePlan),
          scriptThai: output.scriptThai,
          scriptEnglish: output.scriptEnglish,
          hookThai: output.hookThai,
          hookEnglish: output.hookEnglish,
          captionThai: output.captionThai,
          captionEnglish: output.captionEnglish,
          captionChinese: output.captionChinese,
        });
      }).catch(async (err) => {
        console.error("ChatGPT regeneration failed:", err);
        await videoGenerationJobRepository.update(body.jobId, {
          status: VideoGenerationJobStatus.Failed,
          currentStep: VideoGenerationStep.Failed,
        });
      });
    }

    return NextResponse.json({ job: updated }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
