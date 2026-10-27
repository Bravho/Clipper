import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import {
  STORYBOARD_SCRIPT_ERROR_CODE,
  StoryboardScriptError,
} from "@/lib/ai/storyboardScriptResult";

const schema = z.object({
  jobId: z.string().min(1),
  musicSelected: z.boolean().default(true),
  scenes: z
    .array(
      z.object({
        summary: z.string().max(1000).default(""),
        shots: z
          .array(
            z.object({
              assetIndex: z.number().int().nonnegative(),
              seconds: z.number().positive().max(600),
            })
          )
          .min(1)
          .max(40),
      })
    )
    .min(1)
    .max(30),
});

/**
 * POST /api/requests/[id]/script/fit-storyboard
 *
 * Rewrite the speaking script from the storyboard as approved in the studio:
 * one line per scene, about that scene's pictures, held to that scene's time
 * (VideoGenerationService.writeScriptForStoryboard). Only while the script is
 * waiting for approval.
 *
 *   200 { scriptThai, sceneLines, speakSeconds, captionThai }
 *   502 { error, code: "script_ai_failed", reason } — the AI call failed, timed
 *       out or gave an invalid answer. Nothing was saved; the studio shows the
 *       error with "Try again", which calls this route again.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const requester = await requireRole(Role.Requester);
    const { id } = await params;

    const clipRequest = await clipRequestRepository.findById(id);
    if (!clipRequest || clipRequest.userId !== requester.id) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const body = schema.parse(await req.json());
    const job = await videoGenerationJobRepository.findById(body.jobId);
    if (!job || job.requestId !== id) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const result = await videoGenerationService.writeScriptForStoryboard(body.jobId, requester.id, {
      scenes: body.scenes,
      musicSelected: body.musicSelected,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof StoryboardScriptError) {
      console.error("[script/fit-storyboard] AI call failed:", err.reason, err.message);
      return NextResponse.json(
        { error: err.message, code: STORYBOARD_SCRIPT_ERROR_CODE, reason: err.reason },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
