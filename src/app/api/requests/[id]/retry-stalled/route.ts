import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import {
  clipRequestRepository,
  videoGenerationJobRepository,
} from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

/**
 * POST /api/requests/[id]/retry-stalled
 *
 * Requester recovery for a job stranded on a processing step (interrupted inline
 * render or abandoned worker claim). Only succeeds once the job actually looks
 * stalled — the service re-checks `isJobStalled` and rejects a still-healthy
 * render — then re-dispatches the stuck step via the standard retry path.
 */
export async function POST(
  _request: Request,
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

  const job = await videoGenerationJobRepository.findByRequestId(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.retryStalledStep(job.id);
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to retry the stalled step.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
