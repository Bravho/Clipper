import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { videoGenerationService } from "@/services/staff/VideoGenerationService";

const ACCEPTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/webm",
  "audio/webm;codecs=opus",
];
const MAX_AUDIO_SIZE = 100 * 1024 * 1024;

const schema = z.object({
  jobId: z.string().min(1),
  fileName: z.string().min(1),
  fileSizeBytes: z.number().positive().max(MAX_AUDIO_SIZE),
  mimeType: z.string().refine((v) => ACCEPTED_AUDIO_TYPES.some((t) => v.startsWith(t.split(";")[0])), {
    message: "Only MP3, WAV, and WebM audio files are accepted",
  }),
});

export async function POST(req: NextRequest) {
  try {
    const requester = await requireRole(Role.Requester);
    const body = schema.parse(await req.json());

    const result = await videoGenerationService.createVoiceRecordingUpload(
      body.jobId,
      requester.id,
      body.fileName,
      body.fileSizeBytes,
      body.mimeType
    );

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
