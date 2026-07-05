import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { Platform } from "@/domain/enums/Platform";
import { isPublishablePlatform } from "@/config/publishFields";
import type { ChannelPublishingDraft } from "@/domain/models/VideoGenerationJob";

/**
 * Phase 8 — requester publishes ONE distribution channel from the review step.
 *
 * The channel's caption/title/hashtags plus sampled frames of the video are
 * first screened by Gemini (`moderateAndPublishChannel`). If the content is
 * rejected the response carries `approved: false` and a reason (the UI shows it
 * under the button and does not allow the requester to edit-and-retry). If
 * approved, only that channel is posted and the updated drafts are returned.
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
  const jobId = body?.jobId as string | undefined;
  const platform = body?.platform as Platform | undefined;
  const draft = body?.draft as Partial<ChannelPublishingDraft> | undefined;

  if (!jobId || !platform) {
    return NextResponse.json({ error: "Missing jobId or platform." }, { status: 400 });
  }
  if (!isPublishablePlatform(platform)) {
    return NextResponse.json(
      { error: "ช่องทางนี้ไม่รองรับการเผยแพร่จากหน้านี้" },
      { status: 400 }
    );
  }

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const result = await videoGenerationService.moderateAndPublishChannel(
      jobId,
      session.user.id,
      platform,
      draft
    );
    // A moderation rejection is a valid (non-error) outcome — return 200 with
    // approved:false so the client can render the feedback inline.
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to publish.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
