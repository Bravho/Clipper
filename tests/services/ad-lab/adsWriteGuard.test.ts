/**
 * READ-ONLY ads policy: every TikTok/Meta create/update/delete path is blocked
 * before the network. All fetch calls are mocked; none must happen for writes.
 */
jest.mock("@/app/api/ad-lab/_guard", () => ({
  requireAdLabUser: jest.fn(async () => ({ ok: true, user: { id: "u1", email: "t@example.com" } })),
  adLabErrorResponse: jest.fn(),
}));
const createDraftForTarget = jest.fn();
jest.mock("@/services/ad-lab/AdLabAdsService", () => ({
  AdLabAdsError: class AdLabAdsError extends Error {},
  adLabAdsService: { createDraftForTarget },
}));

import {
  ADS_READ_ONLY_MESSAGE_TH,
  AdsReadOnlyViolation,
  AdsWriteBlockedError,
  readOnlyAdsFetch,
} from "@/services/ad-lab/ads-reporting/readOnlyAdsFetch";
import { defaultAdLabAdTargeting } from "@/domain/models/AdLabAdTargeting";

const THAI = "ระบบนี้อ่านข้อมูลโฆษณาได้อย่างเดียว ไม่สามารถสร้าง/แก้ไข/ลบแคมเปญหรือโฆษณาได้";
const OLD_ENV = process.env;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () => new Response(JSON.stringify({ code: 0, data: { list: [] } }), { status: 200 }));
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { process.env = OLD_ENV; });

describe("Thai read-only message", () => {
  it("is the exact approved text", () => {
    expect(ADS_READ_ONLY_MESSAGE_TH).toBe(THAI);
    expect(new AdsWriteBlockedError("x").message).toBe(THAI);
  });
});

describe("tiktokMarketingClient.createPausedSparkAdDraft", () => {
  it.each([false, true])("throws AdsWriteBlockedError with no fetch (credentials configured: %s)", async (configured) => {
    process.env = { ...OLD_ENV };
    if (configured) {
      process.env.TIKTOK_MARKETING_ACCESS_TOKEN = "fake-token";
      process.env.TIKTOK_MARKETING_ADVERTISER_ID = "123";
    } else {
      delete process.env.TIKTOK_MARKETING_ACCESS_TOKEN;
      delete process.env.TIKTOK_BUSINESS_ACCESS_TOKEN;
      delete process.env.TIKTOK_MARKETING_ADVERTISER_ID;
    }
    let mod!: typeof import("@/services/ad-lab/tiktokMarketingClient");
    await jest.isolateModulesAsync(async () => { mod = await import("@/services/ad-lab/tiktokMarketingClient"); });
    const p = mod.createPausedSparkAdDraft({
      targeting: defaultAdLabAdTargeting({ advertiserId: "123", sparkMode: true, sparkPostId: "post1" }),
      campaignName: "c",
      dailyBudgetBaht: 100,
    });
    // isolateModules loads a fresh class copy, so match by name/code instead of instanceof.
    await expect(p).rejects.toMatchObject({ name: "AdsWriteBlockedError", code: "ads_write_blocked", operation: "tiktok.createPausedSparkAdDraft" });
    await expect(p).rejects.toThrow(THAI);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetchAdReport (read) still works as a GET through the guard", async () => {
    process.env = { ...OLD_ENV, TIKTOK_MARKETING_ACCESS_TOKEN: "fake-token", TIKTOK_MARKETING_ADVERTISER_ID: "123" };
    let mod!: typeof import("@/services/ad-lab/tiktokMarketingClient");
    await jest.isolateModulesAsync(async () => { mod = await import("@/services/ad-lab/tiktokMarketingClient"); });
    await mod.fetchAdReport("ad1", "123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    const u = new URL(url);
    expect(u.pathname).toBe("/open_api/v1.3/report/integrated/get/");
    expect(u.searchParams.get("advertiser_id")).toBe("123");
  });
});

describe("guard blocks every TikTok/Meta write before fetch", () => {
  it.each([
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/campaign/create/"],
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/adgroup/create/"],
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/ad/create/"],
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/campaign/update/"],
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/campaign/status/update/"],
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/adgroup/budget/update/"],
    ["POST", "https://business-api.tiktok.com/open_api/v1.3/tt_video/authorize/"],
    ["POST", "https://sandbox-ads.tiktok.com/open_api/v1.3/ad/create/"],
    ["POST", "https://graph.facebook.com/v25.0/act_1/campaigns"],
    ["POST", "https://graph.facebook.com/v25.0/act_1/adsets"],
    ["POST", "https://graph.facebook.com/v25.0/act_1/ads"],
    ["DELETE", "https://graph.facebook.com/v25.0/1234567890"],
    ["GET", "https://graph.facebook.com/v25.0/1234567890?method=delete"],
    ["GET", "https://graph.facebook.com/v25.0/act_1/campaigns?method=post&status=PAUSED"],
  ])("%s %s", async (method, url) => {
    await expect(readOnlyAdsFetch(url, { method })).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ad-lab/ads/draft", () => {
  it("returns 403 with the Thai message and never calls the service or network", async () => {
    const { POST } = await import("@/app/api/ad-lab/ads/draft/route");
    const res = await POST(new Request("http://localhost/api/ad-lab/ads/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: "6f1c2a4e-0a3b-4c5d-8e9f-001122334455", targeting: {} }),
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: THAI, reason: "ads_write_blocked" });
    expect(createDraftForTarget).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("browser client createAdLabAdsDraft", () => {
  it("throws the Thai message without calling fetch", async () => {
    const { createAdLabAdsDraft } = await import("@/features/ad-lab/adLabPublishingClient");
    await expect(createAdLabAdsDraft({
      targetId: "t1",
      targeting: defaultAdLabAdTargeting({}),
    })).rejects.toThrow(THAI);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});