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
import {
  hasDeviceHeldClips,
  localMediaSubmissionSchema,
  MAX_LOCAL_ANALYSIS_BYTES,
  totalAnalysisBytes,
} from "@/lib/mobile/localMediaContract";
import { MANIFEST_RENDER_PLUGIN_VERSION } from "@/lib/mobile/deviceRenderPluginVersion";
import { LOCAL_FIRST_MEDIA_ENABLED } from "@/config/localMedia";
import { PIPELINE_STEP_COSTS } from "@/config/credits";
import { storeLocalMediaDerivatives } from "@/services/LocalMediaDerivativeService";
import { isStudioOnly } from "@/config/studioRollout";

const submitBodySchema = z.object({
  creditConfirmed: z.literal(true),
  rightsConfirmed: z.literal(true),
  aiProcessingConfirmed: z.literal(true),
  localMedia: localMediaSubmissionSchema.optional(),
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
  if (parsed.data.localMedia && !LOCAL_FIRST_MEDIA_ENABLED) {
    return NextResponse.json(
      { error: "Local media processing is not enabled for this deployment." },
      { status: 409 }
    );
  }

  // A phone-held CLIP can only be rendered by the phone that holds it: its
  // moving frames exist nowhere else, and the analysis frame the server keeps
  // is a still. So keeping one locally is allowed exactly when the app build
  // can render a whole manifest end to end.
  //
  // An older build says nothing here (the field did not exist) and so gets the
  // old answer — refused, originals untouched, and the user is told to upload
  // instead. That is what keeps every installed app working: it simply takes
  // the upload path and renders on the Mac Mini as it always did.
  const keepsClipsLocally = parsed.data.localMedia
    ? hasDeviceHeldClips(parsed.data.localMedia)
    : false;
  const deviceCanRender =
    Boolean(parsed.data.localMedia?.deviceRender?.canRenderManifest) &&
    (parsed.data.localMedia?.deviceRender?.nativePluginVersion ?? 0) >=
      MANIFEST_RENDER_PLUGIN_VERSION;

  // Device rendering is required for clips and REQUESTED for anything the
  // phone studio submits. A photo-only studio request from a build that cannot
  // render simply stays on the server path, where its derivatives suffice.
  const rendersOnDevice =
    keepsClipsLocally ||
    (parsed.data.localMedia?.renderOnDevice === true && deviceCanRender);

  // STUDIO_ONLY: every new video is rendered on the phone, so a submission
  // that is not (an older app build, the retired web form, a browser) is
  // refused before anything is stored or charged. The app shows its update
  // screen for this code. Requests already Submitted before the switch fall
  // through to the idempotent recovery below and are not affected.
  if (isStudioOnly() && !rendersOnDevice) {
    const current = await clipRequestService
      .getOwnedRequest(id, session.user.id)
      .catch(() => null);
    if (!current || current.status === RequestStatus.Draft) {
      return NextResponse.json(
        {
          error:
            "Videos are now made in the RClipper app on your phone. Update the app from the App Store or Google Play, then make this video in the studio. Nothing has been charged.",
          code: "app_update_required",
        },
        { status: 409 }
      );
    }
  }

  if (keepsClipsLocally && !deviceCanRender) {
    return NextResponse.json(
      {
        error:
          "This app version cannot edit video on the phone yet, so a clip cannot be kept here. Update the app, or add photos only. Your clip has not been uploaded or submitted.",
        code: "device_render_unavailable",
      },
      { status: 409 }
    );
  }

  if (
    parsed.data.localMedia &&
    totalAnalysisBytes(parsed.data.localMedia.analysisFrames) > MAX_LOCAL_ANALYSIS_BYTES
  ) {
    return NextResponse.json(
      { error: "Analysis previews exceed the 8 MB request limit." },
      { status: 413 }
    );
  }

  try {
    const beforeSubmit = await clipRequestService.getOwnedRequest(id, session.user.id);
    // A studio brief may ask for up to 90 seconds because the PHONE renders it.
    // If this submission is not going to be rendered on the phone after all,
    // the server's own 30-second limit applies — refuse before anything is
    // charged or stored, rather than start a video the server cannot finish.
    if (
      beforeSubmit.status === RequestStatus.Draft &&
      !rendersOnDevice &&
      (beforeSubmit.durationSeconds ?? 0) > PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS
    ) {
      return NextResponse.json(
        {
          error: `Videos longer than ${PIPELINE_STEP_COSTS.MAX_DURATION_SECONDS} seconds are made on the phone, and this app version cannot do that. Shorten the video in Brief, or update the app.`,
          code: "duration_needs_device_render",
        },
        { status: 409 }
      );
    }
    let submitted = beforeSubmit;
    const localMedia = parsed.data.localMedia;
    let localDerivativeUrls: string[] | null = null;

    if (beforeSubmit.status === RequestStatus.Draft) {
      // Prepare only bounded JPEG derivatives before consuming a quota slot.
      // A storage failure leaves the request retryable as a Draft.
      if (localMedia) {
        localDerivativeUrls = await storeLocalMediaDerivatives(id, session.user.id, localMedia);
      }
      submitted = await clipRequestService.submitRequest(
        id,
        session.user.id,
        parsed.data.creditConfirmed,
        parsed.data.rightsConfirmed,
        parsed.data.aiProcessingConfirmed
      );
      if (rendersOnDevice) {
        // Pin the render location now, while we still know the originals were
        // retained on the device. Nothing later can infer it: the asset rows
        // look ordinary apart from their handle, and a request that lost this
        // flag would have its work offered to a worker with no footage.
        submitted = await clipRequestService.markRenderedOnDevice(id, session.user.id);
      }
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
      if (localMedia) {
        localDerivativeUrls = await storeLocalMediaDerivatives(id, session.user.id, localMedia);
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
      // One derived JPEG per local original preserves storyboard indexes and
      // gives the existing montage worker a readable visual proxy.
      imageUrls: localMedia ? (localDerivativeUrls ?? imageUrls) : imageUrls,
      inlineFrames: localMedia?.analysisFrames,
      localMedia: localMedia?.materials,
      title: submitted.title,
      description: submitted.description,
      targetAudience: submitted.targetAudience,
      targetPlatforms: submitted.targetPlatforms,
      preferredStyle: submitted.preferredStyle ?? "",
    });

    return NextResponse.json({ request: submitted, jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    // The phone studio has no quota check of its own before Submit (the web
    // form shows the quota up front), so an exhausted allowance reached it as
    // the bare 500 below. Say what it is, and when the next free slot opens.
    // Matched by name so this route does not pull in the quota service.
    if (
      parsed.data.localMedia?.renderOnDevice === true &&
      err instanceof Error &&
      err.name === "QuotaExhaustedError"
    ) {
      const next = (err as Error & { nextFreeSlotAt?: Date | null }).nextFreeSlotAt ?? null;
      return NextResponse.json(
        {
          error: message,
          code: "quota_exhausted",
          nextFreeSlotAt: next ? next.toISOString() : null,
        },
        { status: 402 }
      );
    }
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
