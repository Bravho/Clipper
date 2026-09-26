import { NextResponse } from "next/server";

import { authorizeDeviceRenderRequest, readJsonBody } from "../_guard";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

/**
 * POST /api/device-render/regenerate   { requestId, jobId }
 *
 * The studio's "Regenerate the video": put a phone-rendered request whose main
 * video is waiting for review back at the scene-design gate, so the studio can
 * send its current storyboard, sound and look and the phone makes the video
 * again. See `reopenDeviceProductionByRequester`.
 */
export async function POST(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const requestId = typeof parsed.body.requestId === "string" ? parsed.body.requestId : "";
  const jobId = typeof parsed.body.jobId === "string" ? parsed.body.jobId : "";
  if (!requestId || !jobId) {
    return NextResponse.json({ error: "Missing requestId or jobId." }, { status: 400 });
  }

  const clipRequest = await clipRequestRepository.findById(requestId);
  if (!clipRequest || clipRequest.userId !== auth.caller.userId) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const job = await videoGenerationJobRepository.findById(jobId);
  if (!job || job.requestId !== requestId) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    const updated = await videoGenerationService.reopenDeviceProductionByRequester(
      jobId,
      auth.caller.userId
    );
    return NextResponse.json({ currentStep: updated.currentStep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The video could not be remade.";
    // Since 2026-09-27 an approved video is never remade (config/requestLimits.ts).
    const code =
      err instanceof Error && (err as { code?: unknown }).code === "locked_after_approval"
        ? "locked_after_approval"
        : undefined;
    return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 409 });
  }
}
