import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { clipRequestRepository, videoGenerationJobRepository } from "@/repositories/index";
import { videoGenerationService } from "@/services/VideoGenerationService";
import {
  ELEVENLABS_FEMALE_VOICE_ID,
  ELEVENLABS_MALE_VOICE_ID,
} from "@/config/elevenLabsVoices";

const schema = z.object({
  jobId: z.string().min(1),
  voiceId: z
    .enum([ELEVENLABS_FEMALE_VOICE_ID, ELEVENLABS_MALE_VOICE_ID])
    .optional(),
});

/**
 * POST /api/requests/[id]/voice/regenerate
 *
 * Requester requests a new ElevenLabs voice generation after listening to the
 * current result. The selected allow-listed voice is persisted on the job.
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

    const updated = await videoGenerationService.regenerateVoice(
      body.jobId,
      requester.id,
      body.voiceId
    );

    return NextResponse.json({ currentStep: updated.currentStep }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
