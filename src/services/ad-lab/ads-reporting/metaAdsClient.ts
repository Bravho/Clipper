import crypto from "crypto";
import { extractMetaResult, resultLabel, type MetaResultEntry } from "./metaResults";
import { readOnlyAdsFetch } from "./readOnlyAdsFetch";
import { buildJoinKey, type NormalizedAdMetricRow } from "./adsReportingModel";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface MetaAdsConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphApiVersion: string;
  oauthScopes: string;
  systemUserToken?: string;
  systemUserAccountIds?: string[];
}

export function getMetaAdsConfig(): MetaAdsConfig {
  const accountIds = (process.env.META_AD_ACCOUNT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    appId: (process.env.META_APP_ID ?? "").trim(),
    appSecret: (process.env.META_APP_SECRET ?? "").trim(),
    redirectUri:
      (process.env.META_REDIRECT_URI ?? "").trim() ||
      "http://localhost:3000/api/ad-lab/ads-reporting/meta/callback",
    graphApiVersion: (process.env.META_GRAPH_API_VERSION ?? "v25.0").trim(),
    oauthScopes: (process.env.META_OAUTH_SCOPES ?? "ads_read").trim(),
    systemUserToken: (process.env.META_SYSTEM_USER_TOKEN ?? "").trim() || undefined,
    systemUserAccountIds: accountIds.length ? accountIds : undefined,
  };
}

/** OAuth needs both the app id (dialog client_id) and the secret (code exchange in the callback). */
export function isMetaOAuthConfigured(): boolean {
  const cfg = getMetaAdsConfig();
  return Boolean(cfg.appId && cfg.appSecret);
}

/** System-user mode: token + at least one ad account id from env (no OAuth needed). */
export function isMetaSystemUserConfigured(): boolean {
  const cfg = getMetaAdsConfig();
  return Boolean(cfg.systemUserToken && cfg.systemUserAccountIds?.length);
}

export function isMetaConfigured(): boolean {
  const cfg = getMetaAdsConfig();
  return Boolean(cfg.appId && cfg.appSecret) || Boolean(cfg.systemUserToken);
}

// ─── Auth URL ────────────────────────────────────────────────────────────────

/** Build the Facebook OAuth dialog URL (never fetched; string only). */
export function buildMetaAuthUrl(state: string, cfg?: MetaAdsConfig): string {
  const { appId, redirectUri, graphApiVersion, oauthScopes } = cfg ?? getMetaAdsConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: oauthScopes,
    response_type: "code",
  });
  return `https://www.facebook.com/${graphApiVersion}/dialog/oauth?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export interface MetaTokenResult {
  accessToken: string;
  expiresAt?: string;
}

export async function exchangeMetaCode(
  code: string,
  cfg?: MetaAdsConfig,
  fetchFn = readOnlyAdsFetch,
): Promise<MetaTokenResult> {
  const { appId, appSecret, redirectUri, graphApiVersion } = cfg ?? getMetaAdsConfig();

  // Short-lived exchange
  const shortParams = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const shortRes = await fetchFn(
    `https://graph.facebook.com/${graphApiVersion}/oauth/access_token?${shortParams.toString()}`,
  );
  await assertMetaOk(shortRes, "short-lived token exchange");
  const shortJson = (await shortRes.json()) as MetaTokenResponse;
  const shortToken = shortJson.access_token;

  // Long-lived exchange
  const longParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const longRes = await fetchFn(
    `https://graph.facebook.com/${graphApiVersion}/oauth/access_token?${longParams.toString()}`,
  );
  await assertMetaOk(longRes, "long-lived token exchange");
  const longJson = (await longRes.json()) as MetaTokenResponse;

  const expiresAt =
    longJson.expires_in != null
      ? new Date(Date.now() + longJson.expires_in * 1000).toISOString()
      : undefined;

  return { accessToken: longJson.access_token, expiresAt };
}

// ─── Ad accounts ─────────────────────────────────────────────────────────────

export interface MetaAdAccount {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  status: number;
  timezoneName: string;
}

export async function listMetaAdAccounts(
  token: string,
  cfg?: MetaAdsConfig,
  fetchFn = readOnlyAdsFetch,
): Promise<MetaAdAccount[]> {
  const { graphApiVersion, appSecret } = cfg ?? getMetaAdsConfig();
  const accounts: MetaAdAccount[] = [];

  const fields = "id,account_id,name,currency,account_status,timezone_name";
  let nextUrl: string | undefined = buildMetaUrl(
    `/${graphApiVersion}/me/adaccounts`,
    { fields, limit: "100", access_token: token },
    token,
    appSecret,
  );

  let pages = 0;
  while (nextUrl && pages < 100) {
    const res = await fetchFn(nextUrl);
    await assertMetaOk(res, "list ad accounts");
    const json = (await res.json()) as MetaPagedResponse<MetaAdAccountRaw>;
    for (const item of json.data ?? []) {
      accounts.push({
        id: item.id,
        accountId: item.account_id ?? item.id.replace("act_", ""),
        name: item.name,
        currency: item.currency ?? "USD",
        status: item.account_status ?? 0,
        timezoneName: item.timezone_name ?? "",
      });
    }
    const rawNext = json.paging?.next;
    nextUrl = rawNext && isGraphFacebookUrl(rawNext) ? rawNext : undefined;
    pages++;
  }

  return accounts;
}

// ─── Insights ────────────────────────────────────────────────────────────────

export type MetaReportLevel = "campaign" | "adset" | "ad";

export interface MetaFetchInsightsOptions {
  token: string;
  actId: string; // e.g. "act_123456"
  level: MetaReportLevel;
  since: string; // YYYY-MM-DD
  until: string;
  fetchFn?: typeof readOnlyAdsFetch;
  sleepFn?: (ms: number) => Promise<void>;
  cfg?: MetaAdsConfig;
}

const MAX_PAGES = 100;
const MAX_RETRIES = 5;

// Meta error codes that indicate rate limiting
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, ...Array.from({ length: 15 }, (_, i) => 80000 + i)]);

const INSIGHTS_FIELDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "actions",
  "cost_per_action_type",
  "video_play_actions",
  "video_continuous_2_sec_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
  "purchase_roas",
  "account_currency",
  // Ads Manager "Results": follow each campaign/ad set's own optimization goal.
  "objective",
  "optimization_goal",
  "results",
  "cost_per_result",
].join(",");

// Conversion/result selection lives in metaResults.ts (follows optimization goal).

export async function fetchMetaInsights(
  options: MetaFetchInsightsOptions,
): Promise<NormalizedAdMetricRow[]> {
  const {
    token,
    actId,
    level,
    since,
    until,
    fetchFn = readOnlyAdsFetch,
    sleepFn = defaultSleep,
    cfg,
  } = options;

  const resolvedCfg = cfg ?? getMetaAdsConfig();
  const { graphApiVersion, appSecret } = resolvedCfg;
  const timeRange = JSON.stringify({ since, until });

  const firstUrl = buildMetaUrl(
    `/${graphApiVersion}/${actId}/insights`,
    {
      level,
      time_increment: "1",
      time_range: timeRange,
      limit: "500",
      fields: INSIGHTS_FIELDS,
      access_token: token,
    },
    token,
    appSecret,
  );

  const rows: NormalizedAdMetricRow[] = [];
  let nextUrl: string | undefined = firstUrl;
  let pages = 0;

  while (nextUrl && pages < MAX_PAGES) {
    let attempt = 0;
    let json: MetaInsightsResponse | null = null;

    while (attempt < MAX_RETRIES) {
      const res = await fetchFn(nextUrl);

      if (res.status === 429) {
        attempt++;
        await sleepFn(exponentialBackoff(attempt));
        continue;
      }

      const raw = (await res.json()) as MetaInsightsResponse | MetaErrorResponse;

      if ("error" in raw && raw.error) {
        const code = raw.error.code ?? 0;
        if (code === 190) throw new MetaTokenExpiredError();
        if (RATE_LIMIT_CODES.has(code)) {
          attempt++;
          const wait = extractRateLimitWait(raw) ?? exponentialBackoff(attempt);
          await sleepFn(wait);
          continue;
        }
        throw new MetaApiError(code, raw.error.message ?? "Insights fetch failed");
      }

      json = raw as MetaInsightsResponse;
      break;
    }

    if (!json) throw new MetaApiError(-1, "Max retries exceeded fetching insights");

    for (const item of json.data ?? []) {
      rows.push(normalizeMetaRow(item, level, actId));
    }

    const rawNext = json.paging?.next;
    nextUrl = rawNext && isGraphFacebookUrl(rawNext) ? rawNext : undefined;
    pages++;
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

function sumVideoActions(actions: MetaAction[] | undefined, actionType: string): number | null {
  if (!actions?.length) return null;
  const matches = actions.filter((a) => a.action_type === actionType);
  if (!matches.length) return null;
  return matches.reduce((sum, a) => sum + safeNum(a.value), 0);
}

function normalizeMetaRow(
  item: MetaInsightItem,
  level: MetaReportLevel,
  actId: string,
): NormalizedAdMetricRow {
  const spend = safeNum(item.spend);
  const impressions = safeNum(item.impressions);
  const clicks = safeNum(item.clicks);

  const rawCtr = item.ctr != null ? safeNum(item.ctr) : null;
  const rawCpc = item.cpc != null ? safeNum(item.cpc) : null;
  const rawCpm = item.cpm != null ? safeNum(item.cpm) : null;

  const ctr = rawCtr ?? (impressions > 0 ? (clicks / impressions) * 100 : null);
  const cpc = rawCpc ?? safeRatio(spend, clicks);
  const cpm = rawCpm ?? (impressions > 0 ? (spend / impressions) * 1000 : null);

  // Results follow the optimization goal (Meta results field first; see metaResults.ts).
  const result = extractMetaResult(item);
  const conversions = result.results;
  const costPerResult = result.costPerResult;
  const label = result.resultType ? resultLabel(result.resultType) : undefined;

  const roasArr = item.purchase_roas;
  const roas =
    roasArr?.length
      ? roasArr.reduce((sum, r) => sum + safeNum(r.value), 0)
      : null;

  // 2s views (continuous_2_sec) and thruplay (p100 equivalent)
  const videoViews2s =
    sumVideoActions(item.video_continuous_2_sec_watched_actions, "video_continuous_2_sec_watched") ??
    sumVideoActions(item.video_play_actions, "video_view");

  // Meta does not provide 6s view counts → always null
  const videoViews6s = null;

  const videoViews100 =
    sumVideoActions(item.video_p100_watched_actions, "video_p100_watched") ??
    sumVideoActions(item.video_thruplay_watched_actions, "video_thruplay_watched");

  const date = item.date_start ?? "";

  const row: NormalizedAdMetricRow = {
    platform: "meta",
    accountId: actId,
    level,
    date,
    campaignId: item.campaign_id ?? "",
    campaignName: item.campaign_name,
    adsetId: item.adset_id,
    adsetName: item.adset_name,
    adId: item.ad_id,
    adName: item.ad_name,
    currency: item.account_currency,
    spend,
    impressions,
    reach: item.reach != null ? safeNum(item.reach) : null,
    clicks,
    ctr,
    cpc,
    cpm,
    frequency: item.frequency != null ? safeNum(item.frequency) : null,
    videoViews2s,
    videoViews6s,
    videoViews100,
    videoPlays: sumVideoActions(item.video_play_actions, "video_view"),
    conversions,
    costPerResult,
    roas,
    ...(result.resultType ? { resultType: result.resultType, resultLabelTh: label?.th, resultLabelEn: label?.en } : {}),
    ...(result.source ? { resultSource: result.source } : {}),
    ...(item.objective ? { objective: item.objective } : {}),
    ...(item.optimization_goal ? { optimizationGoal: item.optimization_goal } : {}),
    joinKey: "",
  };

  row.joinKey = buildJoinKey({
    platform: "meta",
    accountId: actId,
    level,
    campaignId: row.campaignId,
    adsetId: row.adsetId,
    adId: row.adId,
    date,
  });

  return row;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMetaUrl(
  path: string,
  params: Record<string, string>,
  token: string,
  appSecret?: string,
): string {
  const url = new URL(`https://graph.facebook.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (appSecret) {
    const proof = computeAppSecretProof(token, appSecret);
    url.searchParams.set("appsecret_proof", proof);
  }
  return url.toString();
}

function computeAppSecretProof(token: string, appSecret: string): string {
  return crypto.createHmac("sha256", appSecret).update(token).digest("hex");
}

function isGraphFacebookUrl(url: string): boolean {
  try {
    return new URL(url).host === "graph.facebook.com";
  } catch {
    return false;
  }
}

function exponentialBackoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRateLimitWait(raw: MetaErrorResponse): number | undefined {
  // x-business-use-case-usage header is not available in response body,
  // but the error body sometimes includes estimated_time_to_regain_access
  const body = raw.error as Record<string, unknown>;
  const mins = body?.["estimated_time_to_regain_access"];
  if (typeof mins === "number" && mins > 0) return mins * 60 * 1000;
  return undefined;
}

async function assertMetaOk(res: Response, context: string): Promise<void> {
  if (res.ok) return;
  let msg = `Meta API error during ${context}: HTTP ${res.status}`;
  try {
    const json = (await res.json()) as MetaErrorResponse;
    if (json.error?.code === 190) throw new MetaTokenExpiredError();
    msg = json.error?.message ?? msg;
  } catch (e) {
    if (e instanceof MetaTokenExpiredError) throw e;
  }
  throw new MetaApiError(res.status, msg);
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(`Meta API error ${code}: ${message}`);
    this.name = "MetaApiError";
  }
}

export class MetaTokenExpiredError extends Error {
  constructor() {
    super("Meta access token has expired (error 190). Please reconnect.");
    this.name = "MetaTokenExpiredError";
  }
}

// ─── Raw API shapes ───────────────────────────────────────────────────────────

interface MetaTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface MetaAdAccountRaw {
  id: string;
  account_id?: string;
  name: string;
  currency?: string;
  account_status?: number;
  timezone_name?: string;
}

interface MetaAction {
  action_type: string;
  value: string | number;
}

interface MetaInsightItem {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  ctr?: string | number;
  cpc?: string | number;
  cpm?: string | number;
  frequency?: string | number;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  video_play_actions?: MetaAction[];
  video_continuous_2_sec_watched_actions?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];
  video_thruplay_watched_actions?: MetaAction[];
  purchase_roas?: MetaAction[];
  account_currency?: string;
  objective?: string;
  optimization_goal?: string;
  results?: MetaResultEntry[];
  cost_per_result?: MetaResultEntry[];
}

interface MetaPagedResponse<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

type MetaInsightsResponse = MetaPagedResponse<MetaInsightItem>;

interface MetaErrorResponse {
  error?: {
    code?: number;
    message?: string;
    type?: string;
    error_subcode?: number;
    estimated_time_to_regain_access?: number;
  };
}
