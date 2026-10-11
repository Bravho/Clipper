import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import {
  getVoiceCatalog,
  voicePreviewPath,
  warmVoicePreviews,
} from "@/lib/ai/elevenLabsVoiceCatalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/voices
 *
 * The voiceover speakers: id, RClipper's name for the voice, and its gender
 * ("female" | "male" | "unknown"). Genders not written in
 * config/elevenLabsVoices.ts are read from ElevenLabs here, so the studio can
 * show ♀ / ♂ for every voice. Each voice's Thai sample is at
 * `/api/voices/{id}/preview`.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  // Have every sample ready in memory before anyone presses ▶.
  warmVoicePreviews();
  const voices = await getVoiceCatalog();
  return NextResponse.json(
    {
      voices: voices.map((voice) => ({
        ...voice,
        previewUrl: voicePreviewPath(voice.id),
      })),
    },
    { headers: { "Cache-Control": "private, max-age=600" } }
  );
}
