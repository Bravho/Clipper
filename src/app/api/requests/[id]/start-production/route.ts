import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

/**
 * POST /api/requests/[id]/start-production
 *
 * Requester-only. Called after the requester reviews and approves the AI-generated
 * speaking script. Starts iAppTTS voice generation; scene design happens after
 * the voice is approved.
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
    scriptThai,
    scriptEnglish,
    hookEnglish,
    captionThai,
    captionEnglish,
    captionChinese,
    storyboard,
  } = body;

  if (typeof scriptThai !== "string" || !scriptThai.trim()) {
    return NextResponse.json({ error: "Missing required speaking script." }, { status: 400 });
  }

  try {
    const job = await videoGenerationService.startFromRequesterApproval(
      id,
      session.user.id,
      {
        scenePlan: null,
        scriptThai,
        scriptEnglish,
        hookThai: null,
        hookEnglish,
        captionThai: captionThai ?? "",
        captionEnglish: captionEnglish ?? "",
        captionChinese: captionChinese ?? "",
        storyboard: Array.isArray(storyboard) ? storyboard : undefined,
      }
    );
    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start production.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
