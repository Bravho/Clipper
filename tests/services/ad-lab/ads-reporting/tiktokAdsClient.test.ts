import {
  buildTikTokAuthUrl,
  exchangeTikTokAuthCode,
  listTikTokAdvertisers,
  fetchTikTokReport,
  TikTokApiError,
} from "@/services/ad-lab/ads-reporting/tiktokAdsClient";

const CFG = { appId: "APP123", appSecret: "SECRET", redirectUri: "http://localhost:3000/cb" };

function _makeResFactory(body: unknown, status = 200): () => Response {
  return () => new Response(JSON.stringify(body), { status });
}

function makeRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("buildTikTokAuthUrl", () => {
  it("builds correct auth URL string without fetching", () => {
    const url = buildTikTokAuthUrl("state123", CFG);
    expect(url).toContain("business-api.tiktok.com/portal/auth");
    expect(url).toContain("app_id=APP123");
    expect(url).toContain("state=state123");
    // Must NOT use readOnlyAdsFetch — just a string
  });
});

describe("exchangeTikTokAuthCode", () => {
  it("exchanges auth code and returns token + advertiser IDs", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({ code: 0, data: { access_token: "tok123", advertiser_ids: ["adv1", "adv2"], scope: "12345" } }),
    );
    const result = await exchangeTikTokAuthCode("authcode", CFG, mockFetch);
    expect(result.accessToken).toBe("tok123");
    expect(result.advertiserIds).toEqual(["adv1", "adv2"]);
    // Verify it was a POST
    expect(mockFetch).toHaveBeenCalledWith(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws TikTokApiError on non-zero code", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({ code: 40102, message: "Invalid auth code" }),
    );
    await expect(exchangeTikTokAuthCode("bad", CFG, mockFetch)).rejects.toBeInstanceOf(TikTokApiError);
  });
});

describe("listTikTokAdvertisers", () => {
  it("returns parsed advertiser list", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({ code: 0, data: { list: [{ advertiser_id: "111", advertiser_name: "Brand A" }] } }),
    );
    const result = await listTikTokAdvertisers("tok", CFG, mockFetch);
    expect(result).toEqual([{ advertiserId: "111", advertiserName: "Brand A" }]);
  });
});

describe("fetchTikTokReport", () => {
  it("fetches a single page of campaign report", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        code: 0,
        data: {
          list: [
            {
              dimensions: { campaign_id: "c1", stat_time_day: "2026-10-01 00:00:00" },
              metrics: {
                campaign_name: "Test Campaign",
                spend: "100",
                impressions: "5000",
                clicks: "50",
                ctr: "1.0",
                cpc: "2.0",
                cpm: "20.0",
                reach: "4000",
                frequency: "1.25",
                video_play_actions: "4500",
                video_watched_2s: "3000",
                video_watched_6s: "1000",
                video_views_p100: "200",
                conversion: "5",
                cost_per_conversion: "20",
                complete_payment_roas: "2.5",
              },
            },
          ],
          page_info: { total_page: 1, total_number: 1 },
        },
      }),
    );

    const rows = await fetchTikTokReport({
      token: "tok",
      advertiserId: "adv1",
      level: "campaign",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      fetchFn: mockFetch,
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.platform).toBe("tiktok");
    expect(row.level).toBe("campaign");
    expect(row.campaignId).toBe("c1");
    expect(row.campaignName).toBe("Test Campaign");
    expect(row.spend).toBe(100);
    expect(row.impressions).toBe(5000);
    expect(row.clicks).toBe(50);
    expect(row.ctr).toBe(1.0);
    expect(row.videoViews6s).toBe(1000);
    expect(row.videoPlays).toBe(4500);
    expect(row.joinKey).toBe("tiktok:adv1:campaign:c1:-:-:2026-10-01");
  });

  it("normalizes adgroup level to adset", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        code: 0,
        data: {
          list: [
            {
              dimensions: { adgroup_id: "ag1", stat_time_day: "2026-10-02 00:00:00" },
              metrics: {
                adgroup_name: "Ad Group 1",
                campaign_id: "c1",
                spend: "50",
                impressions: "2000",
                clicks: "20",
              },
            },
          ],
          page_info: { total_page: 1, total_number: 1 },
        },
      }),
    );

    const rows = await fetchTikTokReport({
      token: "tok",
      advertiserId: "adv1",
      level: "adgroup",
      startDate: "2026-10-02",
      endDate: "2026-10-02",
      fetchFn: mockFetch,
    });

    expect(rows[0].level).toBe("adset"); // adgroup → adset
    expect(rows[0].adsetId).toBe("ag1");
  });

  it("splits date ranges > 30 days into chunks", async () => {
    const mockFetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        makeRes({ code: 0, data: { list: [], page_info: { total_page: 1, total_number: 0 } } }),
      ),
    );

    await fetchTikTokReport({
      token: "tok",
      advertiserId: "adv1",
      level: "campaign",
      startDate: "2026-09-01",
      endDate: "2026-10-15", // ~44 days → 2 chunks
      fetchFn: mockFetch,
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("retries on rate-limit code 40100 then succeeds", async () => {
    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve(makeRes({ code: 40100, message: "Rate limit" }));
      }
      return Promise.resolve(
        makeRes({ code: 0, data: { list: [], page_info: { total_page: 1, total_number: 0 } } }),
      );
    });
    const noSleep = jest.fn().mockResolvedValue(undefined);

    await fetchTikTokReport({
      token: "tok",
      advertiserId: "adv1",
      level: "campaign",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      fetchFn: mockFetch,
      sleepFn: noSleep,
    });

    expect(noSleep).toHaveBeenCalledTimes(2);
    expect(callCount).toBe(3);
  });

  it("recomputes CTR/CPC/CPM from raw numbers when API omits them", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        code: 0,
        data: {
          list: [
            {
              dimensions: { campaign_id: "c1", stat_time_day: "2026-10-01 00:00:00" },
              metrics: {
                spend: "100",
                impressions: "10000",
                clicks: "100",
                // ctr, cpc, cpm omitted
              },
            },
          ],
          page_info: { total_page: 1, total_number: 1 },
        },
      }),
    );

    const [row] = await fetchTikTokReport({
      token: "tok",
      advertiserId: "adv1",
      level: "campaign",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      fetchFn: mockFetch,
    });

    expect(row.ctr).toBeCloseTo(1.0);       // 100/10000 * 100
    expect(row.cpc).toBeCloseTo(1.0);       // 100/100
    expect(row.cpm).toBeCloseTo(10.0);      // 100/10000 * 1000
  });
});
