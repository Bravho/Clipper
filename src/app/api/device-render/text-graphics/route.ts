import { NextResponse } from "next/server";

import { authorizeDeviceRenderRequest, readJsonBody } from "../_guard";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { isTextGraphicChoice } from "@/config/textGraphicStyles";
import { toManifestTextGraphics } from "@/lib/textGraphics/plan";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";

/**
 * POST /api/device-render/text-graphics
 *   { requestId, choice, scenePlan?, musicTrackId?, fresh? }
 *
 * The studio's "preview with your video": writes (or reuses) the text-graphics
 * plan for the edit as it stands in the studio — its scenes, its music lead-in
 * — and returns it resolved against its style pack, so the studio can play it
 * over the scene pictures before production starts.
 *
 * The plan is saved on the job with the fingerprint of these inputs; approving
 * production with the same edit reuses it instead of asking Claude again.
 * Fail-open: Claude trouble answers the simple fallback plan.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await authorizeDeviceRenderRequest();
  if (!auth.ok) return auth.response;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!requestId) return NextResponse.json({ error: "Missing requestId." }, { status: 400 });
  if (!isTextGraphicChoice(body.choice)) {
    return NextResponse.json({ error: "Unknown text style." }, { status: 400 });
  }
  const choice = body.choice;

  const clipRequest = await clipRequestRepository.findById(requestId);
  if (!clipRequest || clipRequest.userId !== auth.caller.userId) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const job = await videoGenerationJobRepository.findByRequestId(requestId);
  if (!job) return NextResponse.json({ error: "Not ready yet." }, { status: 409 });
  if (choice === "none") return NextResponse.json({ plan: null, textGraphics: null });

  const scenePlan = Array.isArray(body.scenePlan) ? (body.scenePlan as ScenePlan[]) : undefined;
  const musicTrackId = typeof body.musicTrackId === "string" ? body.musicTrackId : null;
  const musicSelected =
    body.musicTrackId === undefined ? undefined : Boolean(musicTrackId && musicTrackId !== "none");

  try {
    const { textGraphicsService } = await import("@/services/TextGraphicsService");
    const plan = await textGraphicsService.ensurePlan(job, {
      choice,
      scenePlan,
      musicSelected,
      fresh: body.fresh === true,
      timeoutMs: 50_000,
    });
    const { videoGenerationService } = await import("@/services/VideoGenerationService");
    const palette = await videoGenerationService.deriveOverlayPaletteForJob(job);
    return NextResponse.json({
      plan,
      textGraphics: toManifestTextGraphics(plan, palette.accent, ""),
    });
  } catch (err) {
    console.error("[device-render/text-graphics] failed:", err);
    return NextResponse.json({ error: "Could not write the text graphics." }, { status: 500 });
  }
}
