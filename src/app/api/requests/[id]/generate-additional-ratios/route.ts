import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

/**
 * Requester triggers generation of the remaining distribution channels' aspect
 * ratios (Phase 7) after approving the primary captioned video. Runs before the
 * automatic Travy render.
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

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.generateAdditionalRatiosByRequester(
      jobId,
      session.user.id
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate additional ratios.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
