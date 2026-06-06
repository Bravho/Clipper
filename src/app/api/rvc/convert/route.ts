import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/helpers";
import { AI_CONFIG } from "@/config/aiTools";

export const maxDuration = 300; // allow up to 5 minutes for RVC inference

export async function POST(req: NextRequest) {
  const serverUrl = AI_CONFIG.rvc.serverUrl;

  try {
    await requireAuth();

    if (!serverUrl) {
      return NextResponse.json(
        { error: "RVC server not configured. Set NEXT_PUBLIC_RVC_SERVER_URL in .env and restart." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    if (!audio) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    // Step 1 — submit job to the async endpoint
    const upstream = new FormData();
    upstream.append("audio", audio, audio.name);
    upstream.append("voice_id", AI_CONFIG.rvc.defaultVoiceModel);

    const submitRes = await fetch(`${serverUrl}/api/rvc/convert`, {
      method: "POST",
      body: upstream,
    });
    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      return NextResponse.json({ error: `RVC submit error ${submitRes.status}: ${text}` }, { status: 502 });
    }
    const { job_id } = await submitRes.json();

    // Step 2 — poll until completed or failed (max 5 minutes, 2 s interval)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await fetch(`${serverUrl}/api/rvc/jobs/${job_id}`);
      if (!statusRes.ok) {
        return NextResponse.json({ error: `RVC status error ${statusRes.status}` }, { status: 502 });
      }
      const job = await statusRes.json();
      if (job.status === "failed") {
        return NextResponse.json({ error: `RVC conversion failed: ${job.error ?? "unknown"}` }, { status: 502 });
      }
      if (job.status !== "completed") continue;

      // Step 3 — download and stream WAV back to the browser
      const dlRes = await fetch(`${serverUrl}/api/rvc/jobs/${job_id}/download`);
      if (!dlRes.ok) {
        return NextResponse.json({ error: `RVC download error ${dlRes.status}` }, { status: 502 });
      }
      const buffer = await dlRes.arrayBuffer();
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "audio/wav",
          "Content-Disposition": "inline",
        },
      });
    }

    return NextResponse.json({ error: "RVC conversion timed out (>5 minutes)" }, { status: 504 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { error: `RVC proxy error (${serverUrl}): ${message}` },
      { status: 500 }
    );
  }
}
