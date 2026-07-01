import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

/**
 * Requester re-renders the subtitle + motion-graphic overlay (Phase 7),
 * optionally changing the subtitle languages, from the overlay review step.
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

  const ALLOWED_LANGS = ["th", "en", "zh"] as const;
  const rawLangs = Array.isArray(body?.subtitleLanguages) ? body.subtitleLanguages : undefined;
  const subtitleLanguages = rawLangs
    ?.filter((l: unknown): l is "th" | "en" | "zh" =>
      ALLOWED_LANGS.includes(l as (typeof ALLOWED_LANGS)[number])
    );

  try {
    const updated = await videoGenerationService.regenerateOverlayByRequester(
      jobId,
      session.user.id,
      subtitleLanguages && subtitleLanguages.length > 0 ? subtitleLanguages : undefined
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to regenerate overlay.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
