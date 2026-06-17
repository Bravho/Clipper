import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { Platform } from "@/domain/enums/Platform";

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
  const targetPlatforms = body?.targetPlatforms as Platform[];
  const selectedMusicTrack = body?.selectedMusicTrack ?? null;
  const subtitleLanguages = body?.subtitleLanguages as ("th" | "en" | "zh")[] | undefined;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }
  if (!targetPlatforms || !Array.isArray(targetPlatforms) || targetPlatforms.length === 0) {
    return NextResponse.json({ error: "Please select at least one distribution channel." }, { status: 400 });
  }
  if (
    subtitleLanguages !== undefined &&
    (!Array.isArray(subtitleLanguages) ||
      subtitleLanguages.length === 0 ||
      !subtitleLanguages.every((l) => l === "th" || l === "en" || l === "zh"))
  ) {
    return NextResponse.json({ error: "Please select at least one subtitle language." }, { status: 400 });
  }

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.approveAnimationByRequester(
      jobId,
      session.user.id,
      targetPlatforms,
      selectedMusicTrack,
      subtitleLanguages
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve animation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
