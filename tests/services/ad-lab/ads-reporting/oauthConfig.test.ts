/**
 * OAuth connect/callback must never redirect to Meta/TikTok with an empty app id,
 * and a Meta system user from env counts as connected. All mocked; no network.
 */
jest.mock("@/app/api/ad-lab/_guard", () => ({
  requireAdLabUser: jest.fn(async () => ({ ok: true, user: { id: "u1", email: "t@example.com" } })),
}));
const startMetaConnect = jest.fn(async () => "https://www.facebook.com/v25.0/dialog/oauth?client_id=952293137527646");
const startTikTokConnect = jest.fn(async () => "https://business-api.tiktok.com/portal/auth?app_id=1");
const completeMetaConnect = jest.fn();
const completeTikTokConnect = jest.fn();
const findByOwnerId = jest.fn(async () => ({ store: { adsReporting: { connections: [], metrics: [], lastDailySyncAt: "2026-10-17T12:36:50.479Z" } }, persistence: "postgresql", pendingSync: false }));
jest.mock("@/repositories/index", () => ({ adLabWorkspaceRepository: { findByOwnerId: (...a: unknown[]) => findByOwnerId(...(a as [])), upsert: jest.fn() } }));
jest.mock("@/services/ad-lab/ads-reporting/adsReportingService", () => {
  const actual = jest.requireActual("@/services/ad-lab/ads-reporting/adsReportingService");
  return { ...actual, startMetaConnect, startTikTokConnect, completeMetaConnect, completeTikTokConnect };
});

const ENV_KEYS = ["META_APP_ID", "META_APP_SECRET", "META_SYSTEM_USER_TOKEN", "META_AD_ACCOUNT_IDS", "TIKTOK_BUSINESS_APP_ID", "TIKTOK_BUSINESS_APP_SECRET"];
const saved: Record<string, string | undefined> = {};
let fetchMock: jest.Mock;
beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  jest.clearAllMocks();
  fetchMock = jest.fn(); global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const req = (path: string) => new Request(`http://localhost:3000${path}`);

describe("GET /meta/connect", () => {
  it("system user configured -> 409 Thai note, no OAuth redirect", async () => {
    process.env.META_SYSTEM_USER_TOKEN = "x"; process.env.META_AD_ACCOUNT_IDS = "act_1";
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/meta/connect/route");
    const res = await GET(req("/api/ad-lab/ads-reporting/meta/connect"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("System User (Ads_Labs)");
    expect(startMetaConnect).not.toHaveBeenCalled();
  });
  it("missing META_APP_ID (even with a token but no account ids) -> 400 Thai error, never redirects", async () => {
    process.env.META_SYSTEM_USER_TOKEN = "x"; process.env.META_APP_SECRET = "s";
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/meta/connect/route");
    const res = await GET(req("/api/ad-lab/ads-reporting/meta/connect"));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body.reason).toBe("oauth_not_configured");
    expect(body.error).toContain("META_APP_ID");
    expect(startMetaConnect).not.toHaveBeenCalled();
  });
  it("missing META_APP_SECRET -> 400 (callback could not finish)", async () => {
    process.env.META_APP_ID = "952293137527646";
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/meta/connect/route");
    const res = await GET(req("/api/ad-lab/ads-reporting/meta/connect"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("META_APP_SECRET");
  });
  it("configured: ?check=1 returns ok without creating state; normal call redirects", async () => {
    process.env.META_APP_ID = "952293137527646"; process.env.META_APP_SECRET = "s";
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/meta/connect/route");
    const pre = await GET(req("/api/ad-lab/ads-reporting/meta/connect?check=1"));
    expect(await pre.json()).toEqual({ ok: true });
    expect(startMetaConnect).not.toHaveBeenCalled();
    const res = await GET(req("/api/ad-lab/ads-reporting/meta/connect"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toContain("client_id=952293137527646");
  });
});

describe("buildMetaAuthUrl never sees an empty client_id via the route", () => {
  it("the real builder would produce client_id= with no app id (the original bug)", async () => {
    const { buildMetaAuthUrl } = await import("@/services/ad-lab/ads-reporting/metaAdsClient");
    const url = new URL(buildMetaAuthUrl("st", { appId: "", appSecret: "", redirectUri: "http://localhost:3000/cb", graphApiVersion: "v25.0", oauthScopes: "ads_read" }));
    expect(url.searchParams.get("client_id")).toBe("");
  });
});

describe("GET /tiktok/connect", () => {
  it("missing TIKTOK_BUSINESS_APP_ID -> 400 Thai error, no redirect", async () => {
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/tiktok/connect/route");
    const res = await GET(req("/api/ad-lab/ads-reporting/tiktok/connect"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("TIKTOK_BUSINESS_APP_ID");
    expect(startTikTokConnect).not.toHaveBeenCalled();
  });
});

describe("callbacks without the secret", () => {
  it("meta callback redirects back with a Thai error and never exchanges the code", async () => {
    process.env.META_APP_ID = "952293137527646";
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/meta/callback/route");
    const res = await GET(new Request("http://localhost:3000/api/ad-lab/ads-reporting/meta/callback?code=c&state=s") as never);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("ads_error=meta_oauth_not_configured");
    expect(decodeURIComponent(loc)).toContain("META_APP_SECRET");
    expect(completeMetaConnect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("tiktok callback likewise", async () => {
    process.env.TIKTOK_BUSINESS_APP_ID = "1";
    const { GET } = await import("@/app/api/ad-lab/ads-reporting/tiktok/callback/route");
    const res = await GET(new Request("http://localhost:3000/api/ad-lab/ads-reporting/tiktok/callback?auth_code=c&state=s") as never);
    expect(res.headers.get("location")).toContain("ads_error=tiktok_oauth_not_configured");
    expect(completeTikTokConnect).not.toHaveBeenCalled();
  });
});

describe("status with a Meta system user", () => {
  it("shows Meta connected via Ads_Labs with the configured account ids; TikTok shows its OAuth error", async () => {
    process.env.META_SYSTEM_USER_TOKEN = "x"; process.env.META_AD_ACCOUNT_IDS = "act_1081141651495394,act_749770862389079";
    const { getAdsReportingStatus } = await import("@/services/ad-lab/ads-reporting/adsReportingService");
    const [tiktok, meta] = await getAdsReportingStatus("u1");
    expect(meta).toMatchObject({
      connected: true, tokenSource: "env_system_user", systemUserLabel: "Ads_Labs",
      accountIds: ["act_1081141651495394", "act_749770862389079"], lastSyncAt: "2026-10-17T12:36:50.479Z",
    });
    expect(JSON.stringify(meta)).not.toContain('"x"');
    expect(tiktok.connected).toBe(false);
    expect(tiktok.oauthError).toContain("TIKTOK_BUSINESS_APP_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});