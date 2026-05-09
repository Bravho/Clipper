import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";

/**
 * POST /api/requests/[id]/start-production
 *
 * Requester-only. Called after the requester reviews and approves the AI-generated
 * scene plan. Creates a VideoGenerationJob and immediately triggers Kling AI video
 * generation, bypassing the staff content-review gate.
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

  const {
    scenePlan,
    scriptThai,
    scriptEnglish,
    hookThai,
    hookEnglish,
    captionThai,
    captionEnglish,
    captionChinese,
  } = body;

  if (!scenePlan || !scriptThai || !scriptEnglish || !hookThai || !hookEnglish) {
    return NextResponse.json({ error: "Missing required analysis fields." }, { status: 400 });
  }

  try {
    const job = await videoGenerationService.startFromRequesterApproval(
      id,
      session.user.id,
      {
        scenePlan: JSON.stringify(scenePlan),
        scriptThai,
        scriptEnglish,
        hookThai,
        hookEnglish,
        captionThai: captionThai ?? "",
        captionEnglish: captionEnglish ?? "",
        captionChinese: captionChinese ?? "",
      }
    );
    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start production.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
