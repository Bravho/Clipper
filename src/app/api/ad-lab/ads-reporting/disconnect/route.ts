export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { disconnectPlatform } from "@/services/ad-lab/ads-reporting/adsReportingService";
import { z } from "zod";

const bodySchema = z.object({
  platform: z.enum(["tiktok", "meta"]),
});

export async function POST(request: Request) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ต้องระบุ platform" }, { status: 400 });
  }

  try {
    await disconnectPlatform(auth.user.id, parsed.data.platform);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/ad-lab/ads-reporting/disconnect]", err);
    return NextResponse.json({ error: "ยกเลิกการเชื่อมต่อไม่สำเร็จ" }, { status: 503 });
  }
}
