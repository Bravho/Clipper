/**
 * TikTok Marketing API client for Ad Lab.
 *
 * Capabilities used here:
 * - Create campaign / ad group / ad as DRAFT or PAUSED (never ENABLE spend from RClipper)
 * - Spark Ads: attach an organic post identity when provided
 * - Pull reporting metrics for Analyze
 * - Search keyword targeting payload for Search Ads-style ad groups
 *
 * When credentials are missing, every write/read returns a deterministic stub
 * so the Publishing + Analyze UI can be exercised without secrets.
 */

import {
  AD_LAB_TIKTOK_MARKETING,
  tiktokMarketingConfigured,
} from "@/config/adLabIntegrations";
import type { AdLabAdTargeting } from "@/domain/models/AdLabAdTargeting";
import { randomUUID } from "crypto";

export interface TikTokDraftResult {
  stub: boolean;
  advertiserId: string;
  campaignId: string;
  adgroupId: string;
  adId: string;
  sparkCode: string | null;
  status: "draft" | "paused" | "stubbed";
  message: string;
  raw?: unknown;
}

export interface TikTokReportRow {
  stub: boolean;
  adId: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  videoViews: number;
  raw?: unknown;
}

function authHeaders(): Record<string, string> {
  return {
    "Access-Token": AD_LAB_TIKTOK_MARKETING.accessToken,
    "Content-Type": "application/json",
  };
}

/** Map Ad Lab targeting into a Marketing API-ish adgroup payload (safe subset). */
export function buildTikTokTargetingPayload(targeting: AdLabAdTargeting): Record<string, unknown> {
  const locationIds = targeting.locations.filter(Boolean);
  const includeKeywords = targeting.searchKeywords.filter((k) => k.action === "include");
  const excludeKeywords = targeting.searchKeywords.filter((k) => k.action === "exclude");

  return {
    location_ids: locationIds,
    age: [
      {
        min: Math.max(13, Math.min(65, targeting.ageMin || 18)),
        max: Math.max(13, Math.min(65, targeting.ageMax || 55)),
      },
    ],
    gender:
      targeting.gender === "all"
        ? "GENDER_UNLIMITED"
        : targeting.gender === "male"
          ? "GENDER_MALE"
          : "GENDER_FEMALE",
    languages: targeting.languages,
    interest_category_ids: targeting.interests,
    action_category_ids: targeting.behaviors,
    audience_ids: targeting.customAudienceIds,
    excluded_audience_ids: [],
    lookalike_audience_ids: targeting.lookalikeAudienceIds,
    operating_systems: targeting.operatingSystems.includes("all")
      ? ["ALL"]
      : targeting.operatingSystems.map((os) => os.toUpperCase()),
    network_types: targeting.connectionTypes.includes("all")
      ? ["ALL"]
      : targeting.connectionTypes.map((c) => (c === "wifi" ? "WIFI" : "CELLULAR")),
    device_models: targeting.devices,
    search_keywords: includeKeywords.map((k) => ({
      keyword: k.text,
      match_type: k.matchType.toUpperCase(),
    })),
    excluded_keywords: excludeKeywords.map((k) => ({
      keyword: k.text,
      match_type: k.matchType.toUpperCase(),
    })),
    spark_ads: targeting.sparkMode,
    identity_id: targeting.sparkPostId || undefined,
    schedule_start_time: targeting.scheduleStart || undefined,
    schedule_end_time: targeting.scheduleEnd || undefined,
    // Hard rule: never ask the API to spend from RClipper.
    operation_status: "DISABLE",
  };
}

async function postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = AD_LAB_TIKTOK_MARKETING.apiBase + path;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      "TikTok Marketing API " + path + " failed (" + response.status + "): " + JSON.stringify(data)
    );
  }
  return data;
}

function stubIds(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Create a paused/disabled campaign structure for the organic (or planned) post.
 * Does not enable delivery. Stubbed when tokens are missing.
 */
export async function createPausedSparkAdDraft(input: {
  targeting: AdLabAdTargeting;
  campaignName: string;
  dailyBudgetBaht: number;
  platformPostId?: string | null;
}): Promise<TikTokDraftResult> {
  const advertiserId = input.targeting.advertiserId || AD_LAB_TIKTOK_MARKETING.advertiserId;
  const targeting = {
    ...input.targeting,
    advertiserId,
    sparkPostId: input.platformPostId || input.targeting.sparkPostId,
  };
  const payload = buildTikTokTargetingPayload(targeting);

  if (!tiktokMarketingConfigured() && !advertiserId) {
    const id = stubIds();
    return {
      stub: true,
      advertiserId: advertiserId || "stub-advertiser",
      campaignId: "stub_camp_" + id,
      adgroupId: "stub_adg_" + id,
      adId: "stub_ad_" + id,
      sparkCode: targeting.sparkMode ? "stub_spark_" + id : null,
      status: "stubbed",
      message:
        "Stub draft only — set TIKTOK_MARKETING_ACCESS_TOKEN + TIKTOK_MARKETING_ADVERTISER_ID for a live paused draft. No money was spent.",
    };
  }

  if (!tiktokMarketingConfigured()) {
    const id = stubIds();
    return {
      stub: true,
      advertiserId,
      campaignId: "stub_camp_" + id,
      adgroupId: "stub_adg_" + id,
      adId: "stub_ad_" + id,
      sparkCode: targeting.sparkMode ? "stub_spark_" + id : null,
      status: "stubbed",
      message:
        "Advertiser id present but Marketing API token missing — stub draft saved. No money was spent.",
    };
  }

  const budget = Math.max(0, Math.round(input.dailyBudgetBaht * 100));
  const campaign = (await postJson("/campaign/create/", {
    advertiser_id: advertiserId,
    objective_type: targeting.objective,
    campaign_name: input.campaignName.slice(0, 100),
    budget_mode: "BUDGET_MODE_DAY",
    budget,
    operation_status: "DISABLE",
  })) as { data?: { campaign_id?: string } };

  const campaignId = campaign.data?.campaign_id;
  if (!campaignId) throw new Error("TikTok campaign/create returned no campaign_id");

  const adgroup = (await postJson("/adgroup/create/", {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    adgroup_name: input.campaignName.slice(0, 80) + "-ag",
    budget_mode: "BUDGET_MODE_DAY",
    budget,
    operation_status: "DISABLE",
    ...payload,
  })) as { data?: { adgroup_id?: string } };

  const adgroupId = adgroup.data?.adgroup_id;
  if (!adgroupId) throw new Error("TikTok adgroup/create returned no adgroup_id");

  const ad = (await postJson("/ad/create/", {
    advertiser_id: advertiserId,
    adgroup_id: adgroupId,
    ad_name: input.campaignName.slice(0, 80) + "-ad",
    operation_status: "DISABLE",
    creatives:
      targeting.sparkMode && targeting.sparkPostId
        ? [{ tiktok_item_id: targeting.sparkPostId }]
        : [],
  })) as { data?: { ad_id?: string } };

  const adId = ad.data?.ad_id;
  if (!adId) throw new Error("TikTok ad/create returned no ad_id");

  return {
    stub: false,
    advertiserId,
    campaignId,
    adgroupId,
    adId,
    sparkCode: targeting.sparkPostId || null,
    status: "paused",
    message: "Paused Marketing API draft created. Enable spend only inside TikTok Ads Manager.",
    raw: { campaign, adgroup, ad },
  };
}

/** Pull basic reporting for one ad id. Stub zeros when not configured. */
export async function fetchAdReport(adId: string, advertiserId?: string): Promise<TikTokReportRow> {
  const adv = advertiserId || AD_LAB_TIKTOK_MARKETING.advertiserId;
  if (!tiktokMarketingConfigured() || !adId || adId.startsWith("stub_")) {
    return {
      stub: true,
      adId,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      videoViews: 0,
    };
  }

  const data = (await postJson("/report/integrated/get/", {
    advertiser_id: adv,
    report_type: "BASIC",
    dimensions: ["ad_id"],
    data_level: "AUCTION_AD",
    metrics: ["spend", "impressions", "clicks", "conversion", "video_play_actions"],
    filters: [{ field_name: "ad_id", filter_type: "IN", filter_value: JSON.stringify([adId]) }],
  })) as {
    data?: { list?: Array<{ metrics?: Record<string, string | number>; dimensions?: { ad_id?: string } }> };
  };

  const row = data.data?.list?.[0];
  const m = row?.metrics ?? {};
  const num = (key: string) => Number(m[key] ?? 0) || 0;
  return {
    stub: false,
    adId,
    spend: num("spend"),
    impressions: num("impressions"),
    clicks: num("clicks"),
    conversions: num("conversion"),
    videoViews: num("video_play_actions"),
    raw: data,
  };
}

export { tiktokMarketingConfigured };
