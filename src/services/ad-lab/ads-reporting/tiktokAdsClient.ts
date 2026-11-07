import { readOnlyAdsFetch } from "./readOnlyAdsFetch";
import { buildJoinKey, type NormalizedAdMetricRow } from "./adsReportingModel";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface TikTokAdsConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function getTikTokAdsConfig(): TikTokAdsConfig {
  return {
    appId: (process.env.TIKTOK_BUSINESS_APP_ID ?? "").trim(),
    appSecret: (process.env.TIKTOK_BUSINESS_APP_SECRET ?? "").trim(),
    redirectUri:
      (process.env.TIKTOK_BUSINESS_REDIRECT_URI ?? "").trim() ||
      "http://localhost:3000/api/ad-lab/ads-reporting/tiktok/callback",
  };
}

export function isTikTokConfigured(): boolean {
  const cfg = getTikTokAdsConfig();
  return Boolean(cfg.appId && cfg.appSecret);
}

// ─── Auth URL ────────────────────────────────────────────────────────────────

/** Build the OAuth redirect URL (never fetched; string only). */
export function buildTikTokAuthUrl(state: string, cfg?: TikTokAdsConfig): string {
  const { appId, redirectUri } = cfg ?? getTikTokAdsConfig();
  const params = new URLSearchParams({
    app_id: appId,
    state,
    redirect_uri: redirectUri,
  });
  return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
}

// ─── Token exchange ──────────────────────────────────────────────────────────

export interface TikTokTokenResult {
  accessToken: string;
  advertiserIds: string[];
  scope: string;
}

export async function exchangeTikTokAuthCode(
  authCode: string,
  cfg?: TikTokAdsConfig,
  fetchFn = readOnlyAdsFetch,
): Promise<TikTokTokenResult> {
  const { appId, appSecret } = cfg ?? getTikTokAdsConfig();
  const res = await fetchFn(
    "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: authCode }),
    },
  );
  const json = (await res.json()) as TikTokApiResponse<TikTokTokenData>;
  if (json.code !== 0) {
    throw new TikTokApiError(json.code, json.message ?? "Token exchange failed");
  }
  return {
    accessToken: json.data.access_token,
    advertiserIds: json.data.advertiser_ids ?? [],
    scope: String(json.data.scope ?? ""),
  };
}

// ─── Advertiser list ─────────────────────────────────────────────────────────

export interface TikTokAdvertiser {
  advertiserId: string;
  advertiserName: string;
}

export async function listTikTokAdvertisers(
  token: string,
  cfg?: TikTokAdsConfig,
  fetchFn = readOnlyAdsFetch,
): Promise<TikTokAdvertiser[]> {
  const { appId, appSecret } = cfg ?? getTikTokAdsConfig();
  const params = new URLSearchParams({ app_id: appId, secret: appSecret });
  const res = await fetchFn(
    `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?${params.toString()}`,
    { headers: { "Access-Token": token } },
  );
  const json = (await res.json()) as TikTokApiResponse<{ list: TikTokAdvertiserItem[] }>;
  if (json.code !== 0) {
    throw new TikTokApiError(json.code, json.message ?? "Advertiser list failed");
  }
  return (json.data?.list ?? []).map((item) => ({
    advertiserId: String(item.advertiser_id),
    advertiserName: item.advertiser_name,
  }));
}

// ─── Report fetching ─────────────────────────────────────────────────────────

export type TikTokReportLevel = "campaign" | "adgroup" | "ad";

export interface TikTokFetchReportOptions {
  token: string;
  advertiserId: string;
  level: TikTokReportLevel;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  fetchFn?: typeof readOnlyAdsFetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const MAX_DAYS_PER_REQUEST = 30;
const MAX_PAGES = 50;
const MAX_RETRIES = 5;
const PAGE_SIZE = 1000;

function splitDateRange(start: string, end: string): Array<{ start: string; end: string }> {
  const ranges: Array<{ start: string; end: string }> = [];
  let current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    const rangeEnd = new Date(current);
    rangeEnd.setDate(rangeEnd.getDate() + MAX_DAYS_PER_REQUEST - 1);
    if (rangeEnd > endDate) rangeEnd.setTime(endDate.getTime());
    ranges.push({
      start: current.toISOString().slice(0, 10),
      end: rangeEnd.toISOString().slice(0, 10),
    });
    current = new Date(rangeEnd);
    current.setDate(current.getDate() + 1);
  }
  return ranges;
}

function levelToDataLevel(level: TikTokReportLevel): string {
  return level === "campaign"
    ? "AUCTION_CAMPAIGN"
    : level === "adgroup"
    ? "AUCTION_ADGROUP"
    : "AUCTION_AD";
}

function levelToDimensions(level: TikTokReportLevel): string[] {
  return [`${level}_id`, "stat_time_day"];
}

const BASE_METRICS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "video_play_actions",
  "video_watched_2s",
  "video_watched_6s",
  "video_views_p100",
  "conversion",
  "cost_per_conversion",
  "complete_payment_roas",
];

function levelMetrics(level: TikTokReportLevel): string[] {
  const names: string[] = [];
  if (level === "campaign") names.push("campaign_name");
  if (level === "adgroup") names.push("adgroup_name", "campaign_id");
  if (level === "ad") names.push("ad_name", "adgroup_id", "campaign_id");
  return [...names, ...BASE_METRICS];
}

async function fetchReportPage(
  options: TikTokFetchReportOptions & { page: number; rangeStart: string; rangeEnd: string },
): Promise<TikTokReportResponse> {
  const { token, advertiserId, level, rangeStart, rangeEnd, page, fetchFn = readOnlyAdsFetch } =
    options;
  const params = new URLSearchParams({
    advertiser_id: advertiserId,
    report_type: "BASIC",
    data_level: levelToDataLevel(level),
    dimensions: JSON.stringify(levelToDimensions(level)),
    metrics: JSON.stringify(levelMetrics(level)),
    start_date: rangeStart,
    end_date: rangeEnd,
    page_size: String(PAGE_SIZE),
    page: String(page),
  });
  const res = await (fetchFn ?? readOnlyAdsFetch)(
    `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params.toString()}`,
    { headers: { "Access-Token": token } },
  );
  return (await res.json()) as TikTokReportResponse;
}

export async function fetchTikTokReport(
  options: TikTokFetchReportOptions,
): Promise<NormalizedAdMetricRow[]> {
  const { level, advertiserId, fetchFn = readOnlyAdsFetch, sleepFn = defaultSleep } = options;
  const ranges = splitDateRange(options.startDate, options.endDate);
  const rows: NormalizedAdMetricRow[] = [];

  for (const range of ranges) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_PAGES) {
      let attempt = 0;
      let json: TikTokReportResponse | null = null;

      while (attempt < MAX_RETRIES) {
        json = await fetchReportPage({
          ...options,
          fetchFn,
          rangeStart: range.start,
          rangeEnd: range.end,
          page,
        });
        if (json.code === 40100 || (json as unknown as { http_status_code?: number }).http_status_code === 429) {
          attempt++;
          await sleepFn(exponentialBackoff(attempt));
          continue;
        }
        break;
      }

      if (!json || json.code !== 0) {
        throw new TikTokApiError(json?.code ?? -1, json?.message ?? "Report fetch failed");
      }

      const pageInfo = json.data?.page_info;
      if (pageInfo) totalPages = Math.min(pageInfo.total_page, MAX_PAGES);

      for (const item of json.data?.list ?? []) {
        rows.push(normalizeTikTokRow(item, level, advertiserId));
      }
      page++;
    }
  }

  return rows;
}

// ─── Normalization ────────────────────────────────────────────────────────────

function safeNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

function normalizeTikTokRow(
  item: TikTokReportItem,
  level: TikTokReportLevel,
  accountId: string,
): NormalizedAdMetricRow {
  const d = item.dimensions ?? {};
  const m = item.metrics ?? {};

  const levelKey = level === "adgroup" ? "adgroup_id" : `${level}_id`;
  const date = String(d["stat_time_day"] ?? "").slice(0, 10);
  const campaignId =
    level === "campaign" ? String(d["campaign_id"] ?? "") : String(m["campaign_id"] ?? d["campaign_id"] ?? "");
  const adsetId = level === "adgroup" ? String(d["adgroup_id"] ?? "") : level === "ad" ? String(m["adgroup_id"] ?? "") : undefined;
  const adId = level === "ad" ? String(d["ad_id"] ?? d[levelKey] ?? "") : undefined;

  const spend = safeNum(m["spend"]);
  const impressions = safeNum(m["impressions"]);
  const clicks = safeNum(m["clicks"]);

  const rawCtr = m["ctr"] != null ? safeNum(m["ctr"]) : null;
  const rawCpc = m["cpc"] != null ? safeNum(m["cpc"]) : null;
  const rawCpm = m["cpm"] != null ? safeNum(m["cpm"]) : null;

  // Recompute if API didn't provide
  const ctr = rawCtr ?? (impressions > 0 ? (clicks / impressions) * 100 : null);
  const cpc = rawCpc ?? safeRatio(spend, clicks);
  const cpm = rawCpm ?? (impressions > 0 ? (spend / impressions) * 1000 : null);

  const row: NormalizedAdMetricRow = {
    platform: "tiktok",
    accountId,
    // TikTok uses "adgroup"; we normalize to "adset" for the unified model
    level: level === "adgroup" ? "adset" : level,
    date,
    campaignId,
    campaignName: m["campaign_name"] ? String(m["campaign_name"]) : undefined,
    adsetId,
    adsetName: m["adgroup_name"] ? String(m["adgroup_name"]) : undefined,
    adId,
    adName: m["ad_name"] ? String(m["ad_name"]) : undefined,
    spend,
    impressions,
    reach: m["reach"] != null ? safeNum(m["reach"]) : null,
    clicks,
    ctr,
    cpc,
    cpm,
    frequency: m["frequency"] != null ? safeNum(m["frequency"]) : null,
    videoViews2s: m["video_watched_2s"] != null ? safeNum(m["video_watched_2s"]) : null,
    videoViews6s: m["video_watched_6s"] != null ? safeNum(m["video_watched_6s"]) : null,
    videoViews100: m["video_views_p100"] != null ? safeNum(m["video_views_p100"]) : null,
    videoPlays: m["video_play_actions"] != null ? safeNum(m["video_play_actions"]) : null,
    conversions: m["conversion"] != null ? safeNum(m["conversion"]) : null,
    costPerResult: m["cost_per_conversion"] != null ? safeNum(m["cost_per_conversion"]) : null,
    roas: m["complete_payment_roas"] != null ? safeNum(m["complete_payment_roas"]) : null,
    joinKey: "",
  };

  row.joinKey = buildJoinKey({
    platform: "tiktok",
    accountId,
    level: row.level,
    campaignId: row.campaignId,
    adsetId: row.adsetId,
    adId: row.adId,
    date,
  });

  return row;
}

// ─── Error + helpers ──────────────────────────────────────────────────────────

export class TikTokApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(`TikTok API error ${code}: ${message}`);
    this.name = "TikTokApiError";
  }
}

function exponentialBackoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Raw API shapes ───────────────────────────────────────────────────────────

interface TikTokApiResponse<T> {
  code: number;
  message?: string;
  data: T;
}

interface TikTokTokenData {
  access_token: string;
  advertiser_ids?: string[];
  scope?: string | number;
}

interface TikTokAdvertiserItem {
  advertiser_id: string | number;
  advertiser_name: string;
}

interface TikTokReportItem {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
}

interface TikTokReportResponse {
  code: number;
  message?: string;
  data?: {
    list?: TikTokReportItem[];
    page_info?: { total_page: number; total_number: number };
  };
}
