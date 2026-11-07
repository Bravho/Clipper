/**
 * Meta "Results" that follow each campaign's / ad set's own optimization goal,
 * so the numbers match Ads Manager.
 *
 * Source priority (checked 2026-10-17 with free read-only GETs on Graph v25.0 and v26.0):
 *  1. Insights fields `results` + `cost_per_result`. Each entry carries an `indicator`
 *     such as "actions:onsite_conversion.messaging_conversation_started_7d" and `values`
 *     per attribution window. This is Ads Manager's own "Results" column.
 *     Docs: https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/
 *  2. Fallback: map `optimization_goal` to an action type and read `actions` /
 *     `cost_per_action_type` (or reach / impressions / thruplay fields).
 *  3. Last resort: the legacy fixed priority list (purchase > lead > messaging).
 * Pure functions, no network.
 */

export interface MetaActionLike { action_type: string; value: string | number }
export interface MetaResultEntry {
  indicator?: string;
  values?: Array<{ value?: string | number; attribution_windows?: string[] }>;
}
export interface MetaResultSourceItem {
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  objective?: string;
  optimization_goal?: string;
  results?: MetaResultEntry[];
  cost_per_result?: MetaResultEntry[];
  actions?: MetaActionLike[];
  cost_per_action_type?: MetaActionLike[];
  video_thruplay_watched_actions?: MetaActionLike[];
}

export type MetaResultSource = "meta_results" | "optimization_goal" | "legacy_priority";

export interface MetaResult {
  resultType: string | null;
  results: number | null;
  costPerResult: number | null;
  source: MetaResultSource | null;
}

export const RESULT_LABELS: Record<string, { th: string; en: string }> = {
  "onsite_conversion.messaging_conversation_started_7d": { th: "เริ่มการสนทนาทางข้อความ", en: "Messaging conversations started" },
  "onsite_conversion.messaging_first_reply": { th: "ข้อความตอบกลับครั้งแรก", en: "Messaging first replies" },
  "onsite_conversion.lead_grouped": { th: "ลีด (ฟอร์มบน Meta)", en: "On-Facebook leads" },
  lead: { th: "ลีด", en: "Leads" },
  "offsite_conversion.fb_pixel_lead": { th: "ลีด (เว็บไซต์)", en: "Website leads" },
  "offsite_conversion.fb_pixel_purchase": { th: "การซื้อ (เว็บไซต์)", en: "Website purchases" },
  purchase: { th: "การซื้อ", en: "Purchases" },
  omni_purchase: { th: "การซื้อ", en: "Purchases" },
  "offsite_conversion.fb_pixel_complete_registration": { th: "ลงทะเบียนสำเร็จ (เว็บไซต์)", en: "Website registrations" },
  "offsite_conversion.fb_pixel_add_to_cart": { th: "เพิ่มลงตะกร้า (เว็บไซต์)", en: "Website adds to cart" },
  "offsite_conversion.fb_pixel_initiate_checkout": { th: "เริ่มชำระเงิน (เว็บไซต์)", en: "Website checkouts initiated" },
  link_click: { th: "คลิกลิงก์", en: "Link clicks" },
  landing_page_view: { th: "การดูหน้า Landing Page", en: "Landing page views" },
  video_thruplay_watched: { th: "ThruPlay", en: "ThruPlays" },
  video_view: { th: "การดูวิดีโอ", en: "Video views" },
  post_engagement: { th: "การมีส่วนร่วมกับโพสต์", en: "Post engagements" },
  page_engagement: { th: "การมีส่วนร่วมกับเพจ", en: "Page engagements" },
  like: { th: "การกดถูกใจเพจ", en: "Page likes" },
  reach: { th: "การเข้าถึง", en: "Reach" },
  impressions: { th: "อิมเพรสชัน", en: "Impressions" },
  "onsite_conversion.flow_complete": { th: "ทำ Instant Experience สำเร็จ", en: "Instant experience completions" },
  "onsite_conversion.purchase": { th: "การซื้อ (บน Meta)", en: "On-Meta purchases" },
  "onsite_conversion.messaging_welcome_message_view": { th: "ดูข้อความต้อนรับ", en: "Welcome message views" },
  mixed: { th: "หลายประเภท", en: "Mixed result types" },
};

export function resultLabel(type: string | null | undefined): { th: string; en: string } {
  if (!type) return { th: "-", en: "-" };
  return RESULT_LABELS[type] ?? { th: type, en: type };
}

/** optimization_goal -> action type used for "results" when Meta's results field is absent. */
export const OPTIMIZATION_GOAL_TO_RESULT: Record<string, string> = {
  CONVERSATIONS: "onsite_conversion.messaging_conversation_started_7d",
  REPLIES: "onsite_conversion.messaging_conversation_started_7d",
  LEAD_GENERATION: "onsite_conversion.lead_grouped",
  QUALITY_LEAD: "onsite_conversion.lead_grouped",
  OFFSITE_CONVERSIONS: "offsite_conversion.fb_pixel_purchase",
  VALUE: "offsite_conversion.fb_pixel_purchase",
  ONSITE_CONVERSIONS: "onsite_conversion.messaging_conversation_started_7d", // Marketplace listings promote via Messenger
  LINK_CLICKS: "link_click",
  LANDING_PAGE_VIEWS: "landing_page_view",
  THRUPLAY: "video_thruplay_watched",
  TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: "video_view",
  POST_ENGAGEMENT: "post_engagement",
  PAGE_LIKES: "like",
  REACH: "reach",
  IMPRESSIONS: "impressions",
};

/** Map OFFSITE_CONVERSIONS custom_event_type to the pixel action type. */
export function offsiteEventToAction(customEventType: string | undefined): string | undefined {
  if (!customEventType) return undefined;
  const map: Record<string, string> = {
    PURCHASE: "offsite_conversion.fb_pixel_purchase",
    LEAD: "offsite_conversion.fb_pixel_lead",
    COMPLETE_REGISTRATION: "offsite_conversion.fb_pixel_complete_registration",
    ADD_TO_CART: "offsite_conversion.fb_pixel_add_to_cart",
    INITIATE_CHECKOUT: "offsite_conversion.fb_pixel_initiate_checkout",
  };
  return map[customEventType.toUpperCase()];
}

const LEGACY_PRIORITY = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
  "onsite_conversion.messaging_conversation_started_7d",
];

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** "actions:onsite_conversion.lead_grouped" -> "onsite_conversion.lead_grouped" */
export function normalizeIndicator(indicator: string): string {
  const i = indicator.indexOf(":");
  return i >= 0 ? indicator.slice(i + 1) : indicator;
}

function entryValue(entry: MetaResultEntry | undefined): number | null {
  const vals = entry?.values;
  if (!vals?.length) return null;
  const preferred = vals.find((v) => v.attribution_windows?.includes("default")) ?? vals[0];
  return num(preferred.value);
}

function actionValue(list: MetaActionLike[] | undefined, type: string): number | null {
  const hits = (list ?? []).filter((a) => a.action_type === type);
  if (!hits.length) return null;
  return hits.reduce((s, a) => s + num(a.value), 0);
}

export function extractMetaResult(item: MetaResultSourceItem): MetaResult {
  const spend = num(item.spend);

  // 1) Meta's own results/cost_per_result with indicator
  const first = item.results?.find((r) => r.indicator);
  if (first?.indicator) {
    const resultType = normalizeIndicator(first.indicator);
    const results = entryValue(first) ?? 0; // indicator without values = 0 results in this row
    const cpe = item.cost_per_result?.find((c) => c.indicator === first.indicator);
    const cprRaw = entryValue(cpe);
    const costPerResult = cprRaw ?? (results > 0 ? spend / results : null);
    return { resultType, results, costPerResult, source: "meta_results" };
  }

  // 2) optimization_goal mapping
  const goal = item.optimization_goal?.toUpperCase();
  const mapped = goal ? OPTIMIZATION_GOAL_TO_RESULT[goal] : undefined;
  if (mapped) {
    let results: number | null;
    if (mapped === "reach") results = item.reach != null ? num(item.reach) : null;
    else if (mapped === "impressions") results = num(item.impressions);
    else if (mapped === "video_thruplay_watched")
      results = actionValue(item.video_thruplay_watched_actions, "video_view") ?? actionValue(item.actions, "video_thruplay_watched");
    else results = actionValue(item.actions, mapped);
    results = results ?? 0;
    const cpa = actionValue(item.cost_per_action_type, mapped);
    let costPerResult = cpa ?? (results > 0 ? spend / results : null);
    if (mapped === "reach" || mapped === "impressions") costPerResult = results > 0 ? (spend / results) * 1000 : null; // per 1,000
    return { resultType: mapped, results, costPerResult, source: "optimization_goal" };
  }

  // 3) legacy fixed priority
  for (const t of LEGACY_PRIORITY) {
    const v = actionValue(item.actions, t);
    if (v != null) {
      const cpa = actionValue(item.cost_per_action_type, t);
      return { resultType: t, results: v, costPerResult: cpa ?? (v > 0 ? spend / v : null), source: "legacy_priority" };
    }
  }
  return { resultType: null, results: null, costPerResult: null, source: null };
}