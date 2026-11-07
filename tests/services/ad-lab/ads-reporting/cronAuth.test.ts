/**
 * Tests cron-sync authorization: missing/wrong/right bearer secret.
 */
jest.mock("@/services/ad-lab/ads-reporting/adsReportingService", () => ({
  syncAdsReporting: jest.fn().mockResolvedValue([]),
}));

describe("POST /api/ad-lab/ads-reporting/cron-sync", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns 503 when ADS_REPORTING_CRON_SECRET is not set", async () => {
    delete process.env.ADS_REPORTING_CRON_SECRET;
    const { POST } = await import("@/app/api/ad-lab/ads-reporting/cron-sync/route");
    const req = new Request("http://localhost/api/ad-lab/ads-reporting/cron-sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 401 when bearer secret is wrong", async () => {
    process.env.ADS_REPORTING_CRON_SECRET = "correct-secret";
    process.env.ADS_REPORTING_SYNC_OWNER_IDS = "";
    const { POST } = await import("@/app/api/ad-lab/ads-reporting/cron-sync/route");
    const req = new Request("http://localhost/api/ad-lab/ads-reporting/cron-sync", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when no Authorization header", async () => {
    process.env.ADS_REPORTING_CRON_SECRET = "correct-secret";
    const { POST } = await import("@/app/api/ad-lab/ads-reporting/cron-sync/route");
    const req = new Request("http://localhost/api/ad-lab/ads-reporting/cron-sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct secret", async () => {
    process.env.ADS_REPORTING_CRON_SECRET = "correct-secret";
    process.env.ADS_REPORTING_SYNC_OWNER_IDS = "user1";
    const { POST } = await import("@/app/api/ad-lab/ads-reporting/cron-sync/route");
    const req = new Request("http://localhost/api/ad-lab/ads-reporting/cron-sync", {
      method: "POST",
      headers: { Authorization: "Bearer correct-secret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });
});
