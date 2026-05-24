import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/helpers";
import { AI_CONFIG } from "@/config/aiTools";

export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const { serverUrl, defaultVoiceModel } = AI_CONFIG.rvc;
    if (!serverUrl) {
      return NextResponse.json({ error: "RVC server not configured" }, { status: 500 });
    }

    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    if (!audio) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    const upstream = new FormData();
    upstream.append("audio", audio, audio.name);
    upstream.append("voice_id", defaultVoiceModel);

    const rvcRes = await fetch(`${serverUrl}/api/rvc/convert`, {
      method: "POST",
      body: upstream,
    });

    if (!rvcRes.ok) {
      const text = await rvcRes.text().catch(() => "");
      return NextResponse.json({ error: `RVC error ${rvcRes.status}: ${text}` }, { status: 502 });
    }

    const data = await rvcRes.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
