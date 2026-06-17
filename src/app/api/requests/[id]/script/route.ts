import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";

/**
 * PATCH /api/requests/[id]/script
 *
 * Requester-only. Saves inline edits to scriptThai and/or captionThai on the
 * active pipeline job without triggering any pipeline action. Writes to the
 * approved_* columns so the VoiceRecordingPanel (staff) reads the latest text.
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
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { jobId, scriptThai, captionThai } = body as Record<string, unknown>;
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const patch: Record<string, string> = {};
  if (typeof scriptThai === "string") patch.approvedScriptThai = sanitizeThaiVoiceScript(scriptThai);
  if (typeof captionThai === "string") patch.approvedCaptionThai = captionThai;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  await videoGenerationJobRepository.update(jobId, patch);
  return NextResponse.json({ ok: true });
}
