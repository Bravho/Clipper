import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/helpers";
import { AI_CONFIG } from "@/config/aiTools";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    await requireAuth();

    const { serverUrl } = AI_CONFIG.rvc;
    if (!serverUrl) {
      return NextResponse.json({ error: "RVC server not configured" }, { status: 500 });
    }

    const { jobId } = await params;
    const rvcRes = await fetch(`${serverUrl}/api/rvc/jobs/${jobId}/download`);

    if (!rvcRes.ok) {
      return NextResponse.json({ error: `RVC download error ${rvcRes.status}` }, { status: 502 });
    }

    const buffer = await rvcRes.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
