import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/ad-lab/avatar/image-upload — DISABLED (410 Gone).
 * Photo mode (Avatar IV) has been replaced by HeyGen Digital Twin (Avatar V).
 * The image-upload endpoint is no longer used; the avatar step now uses a lookId.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Photo mode has been replaced by Digital Twin (Avatar V). Use a HeyGen Digital Twin look ID instead of uploading a photo." },
    { status: 410 }
  );
}
