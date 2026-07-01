// NOTE: This route is kept for compatibility with the AwaitingVoiceApproval step.
// The handler calls approveVoiceConversionByRequester which now triggers the
// scene-design step before any background music selection or video generation.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { Platform } from "@/domain/enums/Platform";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

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
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }
  // Optional distribution channels (ordered, primary first). The primary
  // channel sets the base video's aspect ratio; the rest are export targets.
  const validPlatforms = new Set(Object.values(Platform) as string[]);
  const targetPlatforms = Array.isArray(body?.targetPlatforms)
    ? (body.targetPlatforms.filter(
        (p: unknown): p is Platform => typeof p === "string" && validPlatforms.has(p)
      ) as Platform[])
    : undefined;
  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  try {
    const updated = await videoGenerationService.approveVoiceConversionByRequester(
      jobId,
      session.user.id,
      targetPlatforms
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to approve voice.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
