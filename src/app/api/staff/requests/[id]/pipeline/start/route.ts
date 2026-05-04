import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import { clipRequestRepository, uploadedAssetRepository } from "@/repositories/index";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";

const schema = z.object({
  elevenLabsVoiceId: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const staff = await requireRole(Role.Editor, Role.Admin);
    const body = schema.parse(await req.json());

    const request = await clipRequestRepository.findById(params.id);
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    // Collect uploaded image URLs for ChatGPT Vision
    const assets = await uploadedAssetRepository.findByRequestId(params.id);
    const imageUrls = assets
      .filter(
        (a) =>
          (a.assetType === AssetType.Image || a.assetType === AssetType.Video) &&
          a.uploadStatus === AssetUploadStatus.Uploaded
      )
      .map((a) => a.storageUrl)
      .filter(Boolean);

    const job = await videoGenerationService.initializePipeline(params.id, staff.id, {
      imageUrls,
      description: request.description,
      targetAudience: request.targetAudience,
      targetPlatforms: request.targetPlatforms,
      preferredStyle: request.preferredStyle,
      elevenLabsVoiceId: body.elevenLabsVoiceId,
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
