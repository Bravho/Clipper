import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/config";

/**
 * Regenerate the per-channel publishing drafts in a new header locale. Triggered
 * by the distribution-review UI when the requester switches the site language,
 * so the auto-filled caption/title/hashtags follow the language shown in the
 * header. Reuses existing copy for th/en (no AI) and spends one cheap text
 * translation only when the locale has no pre-generated copy.
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
  const locale = isAppLocale(body?.locale) ? body.locale : DEFAULT_LOCALE;

  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== id) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.regeneratePublishingDrafts(
      jobId,
      session.user.id,
      locale
    );
    return NextResponse.json({ publishingDrafts: updated.publishingDrafts ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to regenerate drafts.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
