import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";
import { sanitizeSceneDescription, sanitizeScenePlanDescriptions } from "@/lib/ai/scenePlanSanitizer";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

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

  const { jobId, scriptThai, captionThai, hookThai, scenes } = body as Record<string, unknown>;
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
  if (typeof hookThai === "string") patch.approvedHookThai = sanitizeThaiVoiceScript(hookThai);

  if (Array.isArray(scenes)) {
    const existingPlan = JSON.parse(job.approvedScenePlan ?? job.scenePlan ?? "[]") as ScenePlan[];
    const nextPlan = existingPlan.map((scene, index) => {
      const edited = scenes[index] as
        | {
            visualDescriptionThai?: unknown;
            durationSeconds?: unknown;
            imageIndexes?: unknown;
          }
        | undefined;

      const imageIndexes = Array.isArray(edited?.imageIndexes)
        ? edited.imageIndexes
            .filter((value): value is number => Number.isInteger(value) && value >= 0)
            .slice(0, 2)
        : scene.imageIndexes;

      const durationSeconds =
        imageIndexes.length === 2
          ? 8
          : Number.isFinite(Number(edited?.durationSeconds)) && Number(edited?.durationSeconds) > 0
            ? Number(edited?.durationSeconds)
            : scene.durationSeconds;

      return {
        ...scene,
        imageIndexes,
        durationSeconds,
        visualDescriptionThai:
          typeof edited?.visualDescriptionThai === "string"
            ? sanitizeSceneDescription(edited.visualDescriptionThai)
            : scene.visualDescriptionThai,
      };
    });

    patch.approvedScenePlan = JSON.stringify(sanitizeScenePlanDescriptions(nextPlan));
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  await videoGenerationJobRepository.update(jobId, patch);
  return NextResponse.json({ ok: true });
}
