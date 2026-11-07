export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { syncAdsReporting } from "@/services/ad-lab/ads-reporting/adsReportingService";
import { z } from "zod";

const bodySchema = z.object({
  platform: z.enum(["tiktok", "meta"]).optional(),
  days: z.number().int().min(1).max(90).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const results = await syncAdsReporting(auth.user.id, parsed.data);
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[POST /api/ad-lab/ads-reporting/sync]", err);
    return NextResponse.json({ error: "ซิงค์ข้อมูลไม่สำเร็จ" }, { status: 503 });
  }
}
