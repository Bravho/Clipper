import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";

/**
 * Phase 8 — requester confirms publishing on the distribution-review step. Posts
 * each not-yet-posted channel via the social services (idempotent — posted
 * channels are skipped). On full success the request is marked Complete/Delivered;
 * any failure keeps the job on the review step with per-channel error causes.
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

  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest || clipRequest.userId !== session.user.id) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const jobId = body?.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }
  const drafts = Array.isArray(body?.drafts)
    ? (body.drafts as ChannelPublishingDraft[])
    : undefined;

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.confirmPublishingByRequester(
      jobId,
      session.user.id,
      drafts
    );
    return NextResponse.json({
      currentStep: updated.currentStep,
      publishingDrafts: updated.publishingDrafts ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to publish.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
