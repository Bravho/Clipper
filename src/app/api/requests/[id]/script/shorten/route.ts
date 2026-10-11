import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";

const schema = z.object({
  jobId: z.string().min(1),
  text: z.string().trim().min(1).max(5000),
  /** The made voice's real length, seconds. */
  voiceSeconds: z.number().positive().max(600),
  /** How long the voice may run to fit the scenes, seconds. */
  targetVoiceSeconds: z.number().positive().max(600),
});

/**
 * POST /api/requests/[id]/script/shorten
 *
 * Shorten the script so a new voice runs about `targetVoiceSeconds` — the last
 * step of the studio's Auto-fit, when the scenes cannot be stretched far
 * enough. Returns the text only; nothing is saved until the voice is made
 * again from it.
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
    const result = await videoGenerationService.shortenScriptForVoice(body.jobId, requester.id, {
      text: body.text,
      voiceSeconds: body.voiceSeconds,
      targetVoiceSeconds: body.targetVoiceSeconds,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
