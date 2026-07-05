import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";

/**
 * Phase 8 — persist requester edits to the per-channel publishing drafts on the
 * distribution-review step (no posting). Used to autosave edits before confirm.
 */
export async function PATCH(
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
  const drafts = body?.drafts as ChannelPublishingDraft[] | undefined;
  if (!jobId || !Array.isArray(drafts)) {
    return NextResponse.json({ error: "Missing jobId or drafts." }, { status: 400 });
  }

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.savePublishingDraftsByRequester(
      jobId,
      session.user.id,
      drafts
    );
    return NextResponse.json({ publishingDrafts: updated.publishingDrafts ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save drafts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
