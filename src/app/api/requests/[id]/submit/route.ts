import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestService } from "@/services/ClipRequestService";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { uploadedAssetRepository } from "@/repositories/index";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { z } from "zod";

const submitBodySchema = z.object({
  creditConfirmed: z.literal(true),
  rightsConfirmed: z.literal(true),
  aiProcessingConfirmed: z.literal(true),
});

/**
 * POST /api/requests/[id]/submit
 *
 * Submits a draft request. Validates legal confirmations, checks credits,
 * deducts credits, and transitions status to Submitted.
 */
export async function POST(
  request: Request,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = submitBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Credit, rights, and AI processing confirmations are required.",
        details: parsed.error.flatten(),
      },
      { status: 422 }
    );
  }

  try {
    const beforeSubmit = await clipRequestService.getOwnedRequest(id, session.user.id);
    let submitted = beforeSubmit;

    if (beforeSubmit.status === RequestStatus.Draft) {
      submitted = await clipRequestService.submitRequest(
        id,
        session.user.id,
        parsed.data.creditConfirmed,
        parsed.data.rightsConfirmed,
        parsed.data.aiProcessingConfirmed
      );
    } else {
      // Idempotent recovery for a lost/failed response after the request was
      // already committed as Submitted. Previously the first call could update
      // status (and charge credits), then fail while creating the pipeline. The
      // upload screen reported that failure only after its final file reached
      // 100%; every Continue attempt then got "Only Draft" forever.
      if (
        beforeSubmit.status !== RequestStatus.Submitted ||
        !beforeSubmit.creditConfirmed ||
        !beforeSubmit.rightsConfirmed ||
        !beforeSubmit.aiProcessingConfirmed
      ) {
        throw new Error("Only Draft requests can be submitted.");
      }

      const existingJob = await videoGenerationService.getCurrentJob(id);
      if (existingJob) {
        return NextResponse.json({
          request: beforeSubmit,
          jobId: existingJob.id,
          resumed: true,
        });
      }
      // Submitted with no job is the precise partial state produced when the
      // first call committed the request but pipeline initialization failed.
      // Continue below and create only the missing job; submitRequest is not
      // called again, so credits and history cannot be duplicated.
    }

    const assets = await uploadedAssetRepository.findByRequestId(id);
    const imageUrls = assets
      .filter(
        (asset) =>
          (asset.assetType === AssetType.Image || asset.assetType === AssetType.Video) &&
          asset.uploadStatus === AssetUploadStatus.Uploaded
      )
      .map((asset) => asset.storageUrl)
      .filter((url): url is string => Boolean(url));

    // A concurrent/lost-response call may have created the job after the status
    // check above. Reuse it instead of asking initializePipeline to create a
    // duplicate (or throw "active pipeline already exists").
    const currentJob = await videoGenerationService.getCurrentJob(id);
    if (currentJob) {
      return NextResponse.json({ request: submitted, jobId: currentJob.id, resumed: true });
    }

    const job = await videoGenerationService.initializePipeline(id, session.user.id, {
      imageUrls,
      title: submitted.title,
      description: submitted.description,
      targetAudience: submitted.targetAudience,
      targetPlatforms: submitted.targetPlatforms,
      preferredStyle: submitted.preferredStyle ?? "",
    });

    return NextResponse.json({ request: submitted, jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    if (message === "Request not found." || message === "Access denied.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Insufficient credits")) {
      return NextResponse.json({ error: message }, { status: 402 });
    }
    if (message.includes("Only Draft") || message.includes("confirmation")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[POST /api/requests/[id]/submit]", err);
    return NextResponse.json({ error: "Failed to submit request." }, { status: 500 });
  }
}
