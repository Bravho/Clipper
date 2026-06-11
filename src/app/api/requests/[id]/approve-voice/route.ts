// NOTE: This route is kept for compatibility with the AwaitingVoiceApproval step.
// The handler now calls approveVoiceConversionByRequester which triggers animation
// generation (GeneratingAnimations) instead of FFmpeg composition directly.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import { Platform } from "@/domain/enums/Platform";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== Role.Requester) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  const clipRequest = await clipRequestRepository.findById(id);
  if (!clipRequest || clipRequest.userId !== session.user.id) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const jobId = body?.jobId;
  const targetPlatforms = body?.targetPlatforms as Platform[];
  const selectedMusicTrack = body?.selectedMusicTrack ?? null;
  if (!jobId || !targetPlatforms?.length) {
    return NextResponse.json({ error: "Missing jobId or targetPlatforms." }, { status: 400 });
  }
  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  try {
    const updated = await videoGenerationService.approveVoiceConversionByRequester(
      jobId,
      session.user.id,
      targetPlatforms,
      selectedMusicTrack
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve voice.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
