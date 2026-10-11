import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/helpers";
import { isSupportedElevenLabsVoiceId } from "@/config/elevenLabsVoices";
import { getVoicePreviewBytes } from "@/lib/ai/elevenLabsVoiceCatalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/voices/[voiceId]/preview?v=<VOICE_PREVIEW_VERSION>
 *
 * A short Thai sample of the voice (the same sentence for every voice), as
 * MP3 bytes from the app's own origin. Made once per voice, then served from
 * the server's memory; cached by the app for a year (the `v` in the URL
 * changes when the sample does). Listening never uses a request's voice makes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ voiceId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  const { voiceId } = await params;
  if (!isSupportedElevenLabsVoiceId(voiceId)) {
    return NextResponse.json({ error: "Unknown voice." }, { status: 404 });
  }
  try {
    const bytes = await getVoicePreviewBytes(voiceId);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error(`[voices] preview for ${voiceId} failed:`, err);
    return NextResponse.json({ error: "The voice sample could not be made." }, { status: 502 });
  }
}
