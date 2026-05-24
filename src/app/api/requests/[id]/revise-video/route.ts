import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

/**
 * POST /api/requests/[id]/revise-video
 *
 * Requester-only. Saves edited script fields and re-triggers Kling video
 * generation from the AwaitingVideoApproval step.
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
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { jobId, scenePlan, hookThai, scriptThai, captionThai } = body;
  if (!jobId || !scenePlan || !hookThai || !scriptThai) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.requestVideoRevisionByRequester(
      jobId,
      session.user.id,
      {
        scenePlan: JSON.stringify(scenePlan as ScenePlan[]),
        hookThai,
        scriptThai,
        captionThai: captionThai ?? "",
      }
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to request revision.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
