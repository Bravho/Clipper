import { z } from "zod";

// ─── Normalized row ──────────────────────────────────────────────────────────

export interface NormalizedAdMetricRow {
  platform: "tiktok" | "meta";
  accountId: string;
  level: "campaign" | "adset" | "ad";
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  currency?: string;
  spend: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  videoViews2s: number | null;
  videoViews6s: number | null;  // always null on Meta; available on TikTok
  videoViews100: number | null;
  /** Video plays (starts): Meta video_play_actions[video_view], TikTok video_play_actions. null = no video data. Optional for rows synced before this field existed. */
  videoPlays?: number | null;
  conversions: number | null;
  costPerResult: number | null;
  roas: number | null;
  /** Result type behind `conversions` (e.g. "onsite_conversion.messaging_conversation_started_7d"). */
  resultType?: string;
  resultLabelTh?: string;
  resultLabelEn?: string;
  /** How the result was derived: Meta's own results field, optimization_goal mapping or legacy list. */
  resultSource?: "meta_results" | "optimization_goal" | "legacy_priority";
  objective?: string;
  optimizationGoal?: string;
  joinKey: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
}

/**
 * Build the deduplication key for a metric row.
 * Format: `${platform}:${accountId}:${level}:${campaignId}:${adsetId??"-"}:${adId??"-"}:${date}`
 */
export function buildJoinKey(row: {
  platform: string;
  accountId: string;
  level: string;
  campaignId: string;
  adsetId?: string;
  adId?: string;
  date: string;
}): string {
  return `${row.platform}:${row.accountId}:${row.level}:${row.campaignId}:${row.adsetId ?? "-"}:${row.adId ?? "-"}:${row.date}`;
}

// ─── Store types ─────────────────────────────────────────────────────────────

export interface AdsReportingConnection {
  id: string;
  platform: "tiktok" | "meta";
  accountIds: string[];
  accountNames?: string[];
  /** AES-256-GCM encrypted access token. Never sent to the client. */
  tokenEnc?: string;
  tokenSource: "oauth" | "env_system_user";
  expiresAt?: string;
  scopes?: string;
  connectedAt: string;
  lastSyncAt?: string;
  lastSyncError?: string;
}

export interface AdsOAuthState {
  state: string;
  platform: "tiktok" | "meta";
  ownerId?: string;
  createdAt: string; // ISO — states expire after 10 minutes
}

export interface AdsReportingState {
  connections: AdsReportingConnection[];
  /** Deduplicated rows by joinKey, capped at METRICS_CAP rows, last 120 days. */
  metrics: NormalizedAdMetricRow[];
  lastDailySyncAt?: string;
  /** Transient OAuth states; cleaned up on use / expiry. */
  oauthStates?: AdsOAuthState[];
}

// ─── Zod schemas (for store persistence) ─────────────────────────────────────

const normalizedRowSchema = z.object({
  platform: z.enum(["tiktok", "meta"]),
  accountId: z.string(),
  level: z.enum(["campaign", "adset", "ad"]),
  date: z.string(),
  campaignId: z.string(),
  campaignName: z.string().optional(),
  adsetId: z.string().optional(),
  adsetName: z.string().optional(),
  adId: z.string().optional(),
  adName: z.string().optional(),
  currency: z.string().optional(),
  spend: z.number(),
  impressions: z.number(),
  reach: z.number().nullable(),
  clicks: z.number(),
  ctr: z.number().nullable(),
  cpc: z.number().nullable(),
  cpm: z.number().nullable(),
  frequency: z.number().nullable(),
  videoViews2s: z.number().nullable(),
  videoViews6s: z.number().nullable(),
  videoViews100: z.number().nullable(),
  videoPlays: z.number().nullable().optional(),
  conversions: z.number().nullable(),
  costPerResult: z.number().nullable(),
  roas: z.number().nullable(),
  resultType: z.string().optional(),
  resultLabelTh: z.string().optional(),
  resultLabelEn: z.string().optional(),
  resultSource: z.enum(["meta_results", "optimization_goal", "legacy_priority"]).optional(),
  objective: z.string().optional(),
  optimizationGoal: z.string().optional(),
  joinKey: z.string(),
  utm: z.object({
    source: z.string().optional(),
    medium: z.string().optional(),
    campaign: z.string().optional(),
    content: z.string().optional(),
    term: z.string().optional(),
  }).optional(),
});

const connectionSchema = z.object({
  id: z.string(),
  platform: z.enum(["tiktok", "meta"]),
  accountIds: z.array(z.string()),
  accountNames: z.array(z.string()).optional(),
  tokenEnc: z.string().optional(),
  tokenSource: z.enum(["oauth", "env_system_user"]),
  expiresAt: z.string().optional(),
  scopes: z.string().optional(),
  connectedAt: z.string(),
  lastSyncAt: z.string().optional(),
  lastSyncError: z.string().optional(),
});

const oauthStateSchema = z.object({
  state: z.string(),
  platform: z.enum(["tiktok", "meta"]),
  ownerId: z.string().optional(),
  createdAt: z.string(),
});

export const adsReportingStateSchema = z.object({
  connections: z.array(connectionSchema).default([]),
  metrics: z.array(normalizedRowSchema).default([]),
  lastDailySyncAt: z.string().optional(),
  oauthStates: z.array(oauthStateSchema).optional(),
});

// ─── Store merge helpers ──────────────────────────────────────────────────────

export const METRICS_MAX_DAYS = 120;
export const METRICS_CAP = 50_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Upsert rows into the existing metrics array.
 * - Deduplicates by joinKey (new row wins)
 * - Removes rows older than METRICS_MAX_DAYS from `now`
 * - Caps total rows at METRICS_CAP (oldest first)
 */
export function mergeMetrics(
  existing: NormalizedAdMetricRow[],
  incoming: NormalizedAdMetricRow[],
  now = new Date(),
): NormalizedAdMetricRow[] {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - METRICS_MAX_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const map = new Map<string, NormalizedAdMetricRow>();
  for (const row of existing) {
    if (row.date >= cutoffStr) map.set(row.joinKey, row);
  }
  for (const row of incoming) {
    if (row.date >= cutoffStr) map.set(row.joinKey, row);
  }

  let rows = Array.from(map.values());
  if (rows.length > METRICS_CAP) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    rows = rows.slice(rows.length - METRICS_CAP);
  }
  return rows;
}

/** Save a new OAuth state, pruning expired ones. */
export function saveOAuthState(
  existing: AdsOAuthState[],
  entry: AdsOAuthState,
  now = new Date(),
): AdsOAuthState[] {
  const cutoff = new Date(now.getTime() - OAUTH_STATE_TTL_MS).toISOString();
  return [...existing.filter((s) => s.createdAt > cutoff), entry];
}

/** Consume and return a valid OAuth state (removes it). Returns undefined if missing/expired. */
export function consumeOAuthState(
  existing: AdsOAuthState[],
  state: string,
  now = new Date(),
): { found: AdsOAuthState; rest: AdsOAuthState[] } | undefined {
  const cutoff = new Date(now.getTime() - OAUTH_STATE_TTL_MS).toISOString();
  const idx = existing.findIndex((s) => s.state === state && s.createdAt > cutoff);
  if (idx === -1) return undefined;
  const found = existing[idx];
  const rest = existing.filter((_, i) => i !== idx);
  return { found, rest };
}
