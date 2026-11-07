export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { requireAdLabUser } from "@/app/api/ad-lab/_guard";
import { adLabWorkspaceRepository } from "@/repositories/index";
import { rankByEfficiency, detectFatigue, comparePlatforms, budgetSuggestions, summarizeResultsByType } from "@/services/ad-lab/ads-reporting/analysis";
import type { NormalizedAdMetricRow } from "@/services/ad-lab/ads-reporting/adsReportingModel";

export async function GET(request: NextRequest) {
  const auth = await requireAdLabUser();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const platform = searchParams.get("platform") as "tiktok" | "meta" | null;
  const level = (searchParams.get("level") ?? "campaign") as NormalizedAdMetricRow["level"];

  try {
    const result = await adLabWorkspaceRepository.findByOwnerId(auth.user.id);
    let rows: NormalizedAdMetricRow[] = result.store?.adsReporting?.metrics ?? [];

    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    if (platform) rows = rows.filter((r) => r.platform === platform);

    // Totals use ONE level only, otherwise campaign + ad set + ad rows triple-count.
    const levelRows = rows.filter((r) => r.level === level);
    return NextResponse.json({
      rows,
      analysis: {
        ranking: rankByEfficiency(rows, level),
        fatigue: detectFatigue(rows),
        platformComparison: comparePlatforms(levelRows),
        resultSummary: summarizeResultsByType(levelRows),
        suggestions: budgetSuggestions(rows, level),
      },
    });
  } catch (err) {
    console.error("[GET /api/ad-lab/ads-reporting/metrics]", err);
    return NextResponse.json({ error: "ไม่สามารถโหลดข้อมูล metrics ได้" }, { status: 503 });
  }
}
