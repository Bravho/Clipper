/**
 * Orchestration layer: syncs ads data from TikTok and Meta into the
 * AdLabStore's adsReporting field via the workspace repository.
 */
import { adLabWorkspaceRepository } from "@/repositories/index";
import {
  mergeMetrics,
  saveOAuthState,
  consumeOAuthState,
  type AdsReportingConnection,
  type AdsReportingState,
} from "./adsReportingModel";
import {
  fetchTikTokReport,
  listTikTokAdvertisers,
  exchangeTikTokAuthCode,
  buildTikTokAuthUrl,
  isTikTokConfigured,
  type TikTokReportLevel, getTikTokAdsConfig } from "./tiktokAdsClient";
import {
  fetchMetaInsights,
  listMetaAdAccounts,
  exchangeMetaCode,
  buildMetaAuthUrl,
  getMetaAdsConfig,
  isMetaConfigured,
  type MetaReportLevel,
} from "./metaAdsClient";
import { encryptToken, decryptToken, AdsEncryptionKeyMissingError } from "./tokenEncryption";
import type { NormalizedAdMetricRow } from "./adsReportingModel";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  platform?: "tiktok" | "meta";
  days?: number;
}

export interface SyncResult {
  platform: "tiktok" | "meta";
  accountId: string;
  rowsAdded: number;
  error?: string;
}

// ─── Store helpers ────────────────────────────────────────────────────────────

async function loadState(ownerId: string): Promise<AdsReportingState> {
  const result = await adLabWorkspaceRepository.findByOwnerId(ownerId);
  return result.store?.adsReporting ?? { connections: [], metrics: [] };
}

async function saveState(ownerId: string, state: AdsReportingState): Promise<void> {
  const result = await adLabWorkspaceRepository.findByOwnerId(ownerId);
  const store = result.store ?? emptyStore();
  await adLabWorkspaceRepository.upsert(ownerId, { ...store, adsReporting: state });
}

function emptyStore() {
  return {
    brands: [],
    drafts: [],
    results: [],
    publishingPlans: [],
    socialAccounts: [],
    selectedBrandId: "",
    adsReporting: { connections: [], metrics: [] } as AdsReportingState,
  };
}

// ─── OAuth flows ──────────────────────────────────────────────────────────────

export async function startTikTokConnect(ownerId: string): Promise<string> {
  const state = crypto.randomBytes(16).toString("hex");
  const stored = await loadState(ownerId);
  stored.oauthStates = saveOAuthState(stored.oauthStates ?? [], {
    state,
    platform: "tiktok",
    ownerId,
    createdAt: new Date().toISOString(),
  });
  await saveState(ownerId, stored);
  return buildTikTokAuthUrl(state);
}

export async function completeTikTokConnect(
  ownerId: string,
  authCode: string,
  stateParam: string,
): Promise<void> {
  const stored = await loadState(ownerId);
  const result = consumeOAuthState(stored.oauthStates ?? [], stateParam);
  if (!result || result.found.platform !== "tiktok") {
    throw new Error("Invalid or expired OAuth state for TikTok");
  }
  stored.oauthStates = result.rest;

  const tokenResult = await exchangeTikTokAuthCode(authCode);

  const encKey = process.env.ADS_REPORTING_ENCRYPTION_KEY;
  if (!encKey) throw new AdsEncryptionKeyMissingError();
  const tokenEnc = encryptToken(tokenResult.accessToken);

  const advertisers = await listTikTokAdvertisers(tokenResult.accessToken);

  const connection: AdsReportingConnection = {
    id: crypto.randomUUID(),
    platform: "tiktok",
    accountIds: advertisers.map((a) => a.advertiserId),
    accountNames: advertisers.map((a) => a.advertiserName),
    tokenEnc,
    tokenSource: "oauth",
    scopes: tokenResult.scope,
    connectedAt: new Date().toISOString(),
  };

  // Replace any existing TikTok connection
  stored.connections = [
    ...stored.connections.filter((c) => c.platform !== "tiktok"),
    connection,
  ];
  await saveState(ownerId, stored);
}

export async function startMetaConnect(ownerId: string): Promise<string> {
  const state = crypto.randomBytes(16).toString("hex");
  const stored = await loadState(ownerId);
  stored.oauthStates = saveOAuthState(stored.oauthStates ?? [], {
    state,
    platform: "meta",
    ownerId,
    createdAt: new Date().toISOString(),
  });
  await saveState(ownerId, stored);
  return buildMetaAuthUrl(state);
}

export async function completeMetaConnect(
  ownerId: string,
  code: string,
  stateParam: string,
): Promise<void> {
  const stored = await loadState(ownerId);
  const result = consumeOAuthState(stored.oauthStates ?? [], stateParam);
  if (!result || result.found.platform !== "meta") {
    throw new Error("Invalid or expired OAuth state for Meta");
  }
  stored.oauthStates = result.rest;

  const tokenResult = await exchangeMetaCode(code);

  const encKey = process.env.ADS_REPORTING_ENCRYPTION_KEY;
  if (!encKey) throw new AdsEncryptionKeyMissingError();
  const tokenEnc = encryptToken(tokenResult.accessToken);

  const accounts = await listMetaAdAccounts(tokenResult.accessToken);

  const connection: AdsReportingConnection = {
    id: crypto.randomUUID(),
    platform: "meta",
    accountIds: accounts.map((a) => a.id),
    accountNames: accounts.map((a) => a.name),
    tokenEnc,
    tokenSource: "oauth",
    expiresAt: tokenResult.expiresAt,
    connectedAt: new Date().toISOString(),
  };

  stored.connections = [
    ...stored.connections.filter((c) => c.platform !== "meta"),
    connection,
  ];
  await saveState(ownerId, stored);
}

export async function disconnectPlatform(
  ownerId: string,
  platform: "tiktok" | "meta",
): Promise<void> {
  const stored = await loadState(ownerId);
  stored.connections = stored.connections.filter((c) => c.platform !== platform);
  await saveState(ownerId, stored);
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncAdsReporting(
  ownerId: string,
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const { platform, days = 28 } = options;
  const stored = await loadState(ownerId);

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const since = startDate.toISOString().slice(0, 10);
  const until = endDate.toISOString().slice(0, 10);

  const results: SyncResult[] = [];
  let allNewRows: NormalizedAdMetricRow[] = [];

  // TikTok sync
  if (!platform || platform === "tiktok") {
    const conn = getTikTokConnection(stored);
    if (conn) {
      for (const accountId of conn.accountIds) {
        try {
          const token = resolveToken(conn);
          const rows = await syncTikTokAccount({ token, accountId, since, until });
          allNewRows = [...allNewRows, ...rows];
          results.push({ platform: "tiktok", accountId, rowsAdded: rows.length });
          conn.lastSyncAt = new Date().toISOString();
          conn.lastSyncError = undefined;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          conn.lastSyncError = msg;
          results.push({ platform: "tiktok", accountId, rowsAdded: 0, error: msg });
        }
      }
    }
  }

  // Meta sync
  if (!platform || platform === "meta") {
    const conn = getMetaConnection(stored);
    if (conn) {
      for (const actId of conn.accountIds) {
        try {
          const token = resolveToken(conn);
          const rows = await syncMetaAccount({ token, actId, since, until });
          allNewRows = [...allNewRows, ...rows];
          results.push({ platform: "meta", accountId: actId, rowsAdded: rows.length });
          conn.lastSyncAt = new Date().toISOString();
          conn.lastSyncError = undefined;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          conn.lastSyncError = msg;
          results.push({ platform: "meta", accountId: actId, rowsAdded: 0, error: msg });
        }
      }
    }
  }

  stored.metrics = mergeMetrics(stored.metrics, allNewRows);
  stored.lastDailySyncAt = new Date().toISOString();
  await saveState(ownerId, stored);

  return results;
}

// ─── Per-account sync ─────────────────────────────────────────────────────────

const TIKTOK_LEVELS: TikTokReportLevel[] = ["campaign", "adgroup", "ad"];
const META_LEVELS: MetaReportLevel[] = ["campaign", "adset", "ad"];

async function syncTikTokAccount(opts: {
  token: string;
  accountId: string;
  since: string;
  until: string;
}): Promise<NormalizedAdMetricRow[]> {
  const rows: NormalizedAdMetricRow[] = [];
  for (const level of TIKTOK_LEVELS) {
    const r = await fetchTikTokReport({
      token: opts.token,
      advertiserId: opts.accountId,
      level,
      startDate: opts.since,
      endDate: opts.until,
    });
    rows.push(...r);
  }
  return rows;
}

async function syncMetaAccount(opts: {
  token: string;
  actId: string;
  since: string;
  until: string;
}): Promise<NormalizedAdMetricRow[]> {
  const rows: NormalizedAdMetricRow[] = [];
  for (const level of META_LEVELS) {
    const r = await fetchMetaInsights({
      token: opts.token,
      actId: opts.actId,
      level,
      since: opts.since,
      until: opts.until,
    });
    rows.push(...r);
  }
  return rows;
}

// ─── Status ───────────────────────────────────────────────────────────────────

/** Display name of the Meta system user behind META_SYSTEM_USER_TOKEN. */
export const META_SYSTEM_USER_LABEL = "Ads_Labs";

/**
 * Thai reason why OAuth cannot start/finish for a platform, or null when it can.
 * step "connect" needs the app id (and the secret, since the callback will need it);
 * step "callback" needs the secret for the code exchange.
 */
export function oauthConfigError(platform: "tiktok" | "meta", step: "connect" | "callback" = "connect"): string | null {
  if (platform === "meta") {
    const cfg = getMetaAdsConfig();
    if (step === "connect" && !cfg.appId) {
      return "ยังไม่ได้ตั้งค่า META_APP_ID ใน .env.local จึงเชื่อมต่อ Meta ผ่าน OAuth ไม่ได้ (Facebook จะขึ้นว่า Invalid app ID) กรุณาตั้งค่าแล้วรีสตาร์ท dev server";
    }
    if (!cfg.appSecret) {
      return "ยังไม่ได้ตั้งค่า META_APP_SECRET ใน .env.local จึงทำขั้นตอนยืนยัน OAuth ของ Meta (callback) ไม่ได้ กรุณาตั้งค่าแล้วรีสตาร์ท dev server";
    }
    return null;
  }
  const t = getTikTokAdsConfig();
  if (step === "connect" && !t.appId) {
    return "ยังไม่ได้ตั้งค่า TIKTOK_BUSINESS_APP_ID ใน .env.local จึงเชื่อมต่อ TikTok ผ่าน OAuth ไม่ได้ กรุณาตั้งค่าแล้วรีสตาร์ท dev server";
  }
  if (!t.appSecret) {
    return "ยังไม่ได้ตั้งค่า TIKTOK_BUSINESS_APP_SECRET ใน .env.local จึงทำขั้นตอนยืนยัน OAuth ของ TikTok (callback) ไม่ได้ กรุณาตั้งค่าแล้วรีสตาร์ท dev server";
  }
  return null;
}

export interface PlatformStatus {
  platform: "tiktok" | "meta";
  configured: boolean;
  connected: boolean;
  accountIds: string[];
  accountNames?: string[];
  lastSyncAt?: string;
  lastSyncError?: string;
  tokenSource?: "oauth" | "env_system_user";
  /** e.g. "Ads_Labs" when connected through META_SYSTEM_USER_TOKEN. */
  systemUserLabel?: string;
  /** Thai reason OAuth can't run (missing app id/secret); undefined when OAuth is possible. */
  oauthError?: string;
}

export async function getAdsReportingStatus(ownerId: string): Promise<PlatformStatus[]> {
  const stored = await loadState(ownerId);

  return [
    buildPlatformStatus("tiktok", stored, isTikTokConfigured()),
    buildPlatformStatus("meta", stored, isMetaConfigured()),
  ];
}

function buildPlatformStatus(
  platform: "tiktok" | "meta",
  state: AdsReportingState,
  configured: boolean,
): PlatformStatus {
  const conn = state.connections.find((c) => c.platform === platform);
  const oauthError = oauthConfigError(platform) ?? undefined;
  // Meta system user from env counts as connected when no OAuth connection is stored.
  if (platform === "meta" && !conn) {
    const cfg = getMetaAdsConfig();
    if (cfg.systemUserToken && cfg.systemUserAccountIds?.length) {
      return {
        platform,
        configured: true,
        connected: true,
        accountIds: cfg.systemUserAccountIds,
        lastSyncAt: state.lastDailySyncAt,
        tokenSource: "env_system_user",
        systemUserLabel: META_SYSTEM_USER_LABEL,
        oauthError,
      };
    }
  }
  return {
    oauthError,
    platform,
    configured,
    connected: Boolean(conn),
    accountIds: conn?.accountIds ?? [],
    accountNames: conn?.accountNames,
    lastSyncAt: conn?.lastSyncAt,
    lastSyncError: conn?.lastSyncError,
    tokenSource: conn?.tokenSource,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTikTokConnection(state: AdsReportingState): AdsReportingConnection | undefined {
  return state.connections.find((c) => c.platform === "tiktok");
}

function getMetaConnection(state: AdsReportingState): AdsReportingConnection | undefined {
  // Prefer OAuth connection; fall back to env system user
  const oauth = state.connections.find((c) => c.platform === "meta" && c.tokenSource === "oauth");
  if (oauth) return oauth;
  const cfg = getMetaAdsConfig();
  if (cfg.systemUserToken) {
    return {
      id: "env_system_user",
      platform: "meta",
      accountIds: cfg.systemUserAccountIds ?? [],
      tokenSource: "env_system_user",
      connectedAt: "",
    };
  }
  return state.connections.find((c) => c.platform === "meta");
}

function resolveToken(conn: AdsReportingConnection): string {
  if (conn.tokenSource === "env_system_user") {
    const cfg = getMetaAdsConfig();
    if (!cfg.systemUserToken) throw new Error("META_SYSTEM_USER_TOKEN is not set");
    return cfg.systemUserToken;
  }
  if (!conn.tokenEnc) throw new Error("No token stored for this connection");
  return decryptToken(conn.tokenEnc);
}

// ─── Env-var config names for status display (never values) ──────────────────

export function getTikTokEnvNames(): string[] {
  return ["TIKTOK_BUSINESS_APP_ID", "TIKTOK_BUSINESS_APP_SECRET", "TIKTOK_BUSINESS_REDIRECT_URI"];
}

export function getMetaEnvNames(): string[] {
  return [
    "META_APP_ID",
    "META_APP_SECRET",
    "META_REDIRECT_URI",
    "META_GRAPH_API_VERSION",
    "META_OAUTH_SCOPES",
    "META_SYSTEM_USER_TOKEN",
    "META_AD_ACCOUNT_IDS",
  ];
}
