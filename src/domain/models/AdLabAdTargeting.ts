/**
 * TikTok Ads targeting plan for Ad Lab Publishing.
 *
 * Stored on the per-channel publishing settings (JSON workspace) and copied
 * onto publication targets when a Marketing API draft is created. Ad Lab never
 * charges for ads — drafts are created PAUSED/DISABLE; the owner pays in
 * TikTok Ads Manager.
 */

export const TIKTOK_AD_OBJECTIVES = [
  "TRAFFIC",
  "VIDEO_VIEWS",
  "REACH",
  "ENGAGEMENT",
  "CONVERSIONS",
  "LEAD_GENERATION",
  "APP_PROMOTION",
  "PRODUCT_SALES",
] as const;

export type TikTokAdObjective = (typeof TIKTOK_AD_OBJECTIVES)[number];

export const TIKTOK_AD_OBJECTIVE_LABELS: Record<TikTokAdObjective, string> = {
  TRAFFIC: "Traffic (คลิกไปเว็บ/แอป)",
  VIDEO_VIEWS: "Video Views",
  REACH: "Reach",
  ENGAGEMENT: "Engagement",
  CONVERSIONS: "Conversions",
  LEAD_GENERATION: "Lead Generation",
  APP_PROMOTION: "App Promotion",
  PRODUCT_SALES: "Product Sales",
};

export type AdLabKeywordMatchType = "broad" | "phrase" | "exact";
export type AdLabKeywordAction = "include" | "exclude";

export interface AdLabSearchKeyword {
  text: string;
  matchType: AdLabKeywordMatchType;
  action: AdLabKeywordAction;
}

export interface AdLabAdTargeting {
  /** Campaign objective (TikTok Marketing API objective_type). */
  objective: TikTokAdObjective;
  /** Country / region codes or names (e.g. TH, Bangkok). */
  locations: string[];
  ageMin: number;
  ageMax: number;
  gender: "all" | "male" | "female";
  languages: string[];
  interests: string[];
  behaviors: string[];
  /** Custom audience IDs from Ads Manager (placeholders until synced). */
  customAudienceIds: string[];
  lookalikeAudienceIds: string[];
  devices: Array<"mobile" | "desktop" | "tablet">;
  operatingSystems: Array<"android" | "ios" | "all">;
  connectionTypes: Array<"wifi" | "cellular" | "all">;
  /** Search Ads keyword targeting (include / exclude). */
  searchKeywords: AdLabSearchKeyword[];
  /** Use the organic post (Spark Ads) instead of uploading a new creative. */
  sparkMode: boolean;
  /** Organic platform_post_id / item_id after publish (filled when known). */
  sparkPostId: string;
  /** TikTok advertiser (ad account) id. */
  advertiserId: string;
  scheduleStart: string;
  scheduleEnd: string;
  /** Light attribution for Chinese_TTT → LINE / Stripe. */
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  /** Free-text note for how LINE/Stripe tags should match this ad. */
  attributionNote: string;
}

export type AdLabAdsDraftStatus =
  | "none"
  | "stubbed"
  | "draft"
  | "paused"
  | "in_review"
  | "active"
  | "error";

/** Persisted on a publication target after a Marketing API (or stub) draft. */
export interface AdLabAdsLink {
  advertiserId: string;
  campaignId: string | null;
  adgroupId: string | null;
  adId: string | null;
  sparkCode: string | null;
  status: AdLabAdsDraftStatus;
  targeting: AdLabAdTargeting | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** True when created without live Marketing API credentials. */
  stub: boolean;
}

export function defaultAdLabAdTargeting(
  partial?: Partial<AdLabAdTargeting>
): AdLabAdTargeting {
  return {
    objective: "TRAFFIC",
    locations: ["TH"],
    ageMin: 18,
    ageMax: 55,
    gender: "all",
    languages: ["th"],
    interests: [],
    behaviors: [],
    customAudienceIds: [],
    lookalikeAudienceIds: [],
    devices: ["mobile"],
    operatingSystems: ["all"],
    connectionTypes: ["all"],
    searchKeywords: [],
    sparkMode: true,
    sparkPostId: "",
    advertiserId: "",
    scheduleStart: "",
    scheduleEnd: "",
    utmSource: "tiktok",
    utmMedium: "paid",
    utmCampaign: "chinese_ttt",
    utmContent: "",
    attributionNote: "",
    ...partial,
  };
}

/** Parse pasted keyword lines: `word` or `+word` (include) / `-word` (exclude). */
export function parseSearchKeywordLines(text: string): AdLabSearchKeyword[] {
  return text
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      let action: AdLabKeywordAction = "include";
      let rest = raw;
      if (rest.startsWith("-")) {
        action = "exclude";
        rest = rest.slice(1).trim();
      } else if (rest.startsWith("+")) {
        rest = rest.slice(1).trim();
      }
      let matchType: AdLabKeywordMatchType = "broad";
      if (rest.startsWith("[") && rest.endsWith("]")) {
        matchType = "exact";
        rest = rest.slice(1, -1).trim();
      } else if (rest.startsWith('"') && rest.endsWith('"')) {
        matchType = "phrase";
        rest = rest.slice(1, -1).trim();
      }
      return { text: rest, matchType, action };
    })
    .filter((k) => k.text.length > 0);
}

export function formatSearchKeywordLines(keywords: AdLabSearchKeyword[]): string {
  return keywords
    .map((k) => {
      const body =
        k.matchType === "exact"
          ? `[${k.text}]`
          : k.matchType === "phrase"
            ? `"${k.text}"`
            : k.text;
      return k.action === "exclude" ? `-${body}` : body;
    })
    .join("\n");
}

/** Append UTM query params to a landing URL when present. */
export function appendAdLabUtm(url: string, targeting: Pick<AdLabAdTargeting, "utmSource" | "utmMedium" | "utmCampaign" | "utmContent">): string {
  if (!url.trim()) return url;
  try {
    const u = new URL(url);
    if (targeting.utmSource) u.searchParams.set("utm_source", targeting.utmSource);
    if (targeting.utmMedium) u.searchParams.set("utm_medium", targeting.utmMedium);
    if (targeting.utmCampaign) u.searchParams.set("utm_campaign", targeting.utmCampaign);
    if (targeting.utmContent) u.searchParams.set("utm_content", targeting.utmContent);
    return u.toString();
  } catch {
    return url;
  }
}
