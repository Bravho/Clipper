import { NextResponse } from "next/server";
import { z } from "zod";
import { adLabErrorResponse, requireAdLabUser } from "../../_guard";
import { AdLabAdsError, adLabAdsService } from "@/services/ad-lab/AdLabAdsService";
import { defaultAdLabAdTargeting, TIKTOK_AD_OBJECTIVES } from "@/domain/models/AdLabAdTargeting";

export const dynamic = "force-dynamic";

const targetingSchema = z.object({
  objective: z.enum(TIKTOK_AD_OBJECTIVES as unknown as [string, ...string[]]),
  locations: z.array(z.string()).default([]),
  ageMin: z.number().min(13).max(65).default(18),
  ageMax: z.number().min(13).max(65).default(55),
  gender: z.enum(["all", "male", "female"]).default("all"),
  languages: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
  behaviors: z.array(z.string()).default([]),
  customAudienceIds: z.array(z.string()).default([]),
  lookalikeAudienceIds: z.array(z.string()).default([]),
  devices: z.array(z.enum(["mobile", "desktop", "tablet"])).default(["mobile"]),
  operatingSystems: z.array(z.enum(["android", "ios", "all"])).default(["all"]),
  connectionTypes: z.array(z.enum(["wifi", "cellular", "all"])).default(["all"]),
  searchKeywords: z.array(z.object({
    text: z.string(),
    matchType: z.enum(["broad", "phrase", "exact"]),
    action: z.enum(["include", "exclude"]),
  })).default([]),
  sparkMode: z.boolean().default(true),
  sparkPostId: z.string().default(""),
  advertiserId: z.string().default(""),
  scheduleStart: z.string().default(""),
  scheduleEnd: z.string().default(""),
  utmSource: z.string().default("tiktok"),
  utmMedium: z.string().default("paid"),
  utmCampaign: z.string().default("chinese_ttt"),
  utmContent: z.string().default(""),
  attributionNote: z.string().default(""),
}).partial();

const bodySchema = z.object({
  targetId: z.string().uuid(),
  targeting: targetingSchema,
  dailyBudgetBaht: z.number().min(0).max(10_000_000).optional(),
  campaignName: z.string().max(300).optional(),
});

/** POST /api/ad-lab/ads/draft — create paused/stub Marketing API draft for a TikTok target. Never enables spend. */
export async function POST(request: Request) {
  const guard = await requireAdLabUser();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid ads draft request." }, { status: 400 });
  try {
    const result = await adLabAdsService.createDraftForTarget(
      guard.user.id,
      parsed.data.targetId,
      defaultAdLabAdTargeting(parsed.data.targeting as never),
      { dailyBudgetBaht: parsed.data.dailyBudgetBaht, campaignName: parsed.data.campaignName }
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AdLabAdsError) {
      const status = err.code === "not_found" ? 404 : err.code === "not_tiktok" ? 400 : 502;
      return NextResponse.json({ error: err.message, reason: err.code }, { status });
    }
    return adLabErrorResponse("POST /api/ad-lab/ads/draft", err);
  }
}
