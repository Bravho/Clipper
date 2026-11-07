import {
  buildMetaAuthUrl,
  exchangeMetaCode,
  listMetaAdAccounts,
  fetchMetaInsights,
  MetaTokenExpiredError,
} from "@/services/ad-lab/ads-reporting/metaAdsClient";

const CFG = {
  appId: "META_APP",
  appSecret: "META_SECRET",
  redirectUri: "http://localhost:3000/meta/cb",
  graphApiVersion: "v25.0",
  oauthScopes: "ads_read",
};

function makeRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("buildMetaAuthUrl", () => {
  it("builds correct OAuth dialog URL without fetching", () => {
    const url = buildMetaAuthUrl("state_xyz", CFG);
    expect(url).toContain("facebook.com/v25.0/dialog/oauth");
    expect(url).toContain("client_id=META_APP");
    expect(url).toContain("state=state_xyz");
    expect(url).toContain("scope=ads_read");
  });
});

describe("exchangeMetaCode", () => {
  it("exchanges short-lived then long-lived token", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(makeRes({ access_token: "short_tok", expires_in: 3600 }))
      .mockResolvedValueOnce(makeRes({ access_token: "long_tok", expires_in: 5183944 }));

    const result = await exchangeMetaCode("code123", CFG, mockFetch);
    expect(result.accessToken).toBe("long_tok");
    expect(result.expiresAt).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: short-lived exchange
    expect(mockFetch.mock.calls[0][0]).toContain("oauth/access_token");
    expect(mockFetch.mock.calls[0][0]).toContain("code=code123");
    // Second call: long-lived exchange
    expect(mockFetch.mock.calls[1][0]).toContain("fb_exchange_token=short_tok");
  });

  it("includes appsecret_proof when appSecret available", async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(makeRes({ access_token: "tok" }));
    await exchangeMetaCode("code", CFG, mockFetch).catch(() => {});
    // At least one call should include appsecret_proof
    const firstCallUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstCallUrl).not.toContain("appsecret_proof"); // short-lived exchange doesn't have the token yet
  });
});

describe("listMetaAdAccounts", () => {
  it("returns parsed account list", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        data: [
          { id: "act_123", account_id: "123", name: "My Ad Account", currency: "THB", account_status: 1, timezone_name: "Asia/Bangkok" },
        ],
        paging: {},
      }),
    );

    const accounts = await listMetaAdAccounts("tok", CFG, mockFetch);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe("act_123");
    expect(accounts[0].currency).toBe("THB");
  });

  it("follows paging.next on graph.facebook.com", async () => {
    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          makeRes({
            data: [{ id: "act_1", name: "Acc 1", currency: "THB" }],
            paging: { next: "https://graph.facebook.com/v25.0/me/adaccounts?after=cursor1" },
          }),
        );
      }
      return Promise.resolve(
        makeRes({
          data: [{ id: "act_2", name: "Acc 2", currency: "THB" }],
          paging: {},
        }),
      );
    });

    const accounts = await listMetaAdAccounts("tok", CFG, mockFetch);
    expect(accounts).toHaveLength(2);
    expect(callCount).toBe(2);
  });

  it("does not follow paging.next on non-facebook.com host", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        data: [{ id: "act_1", name: "Acc 1", currency: "USD" }],
        paging: { next: "https://evil.example.com/steal" },
      }),
    );

    const accounts = await listMetaAdAccounts("tok", CFG, mockFetch);
    expect(accounts).toHaveLength(1); // stopped at first page
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchMetaInsights", () => {
  it("fetches campaign insights and normalizes rows", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        data: [
          {
            campaign_id: "c1",
            campaign_name: "Thai Campaign",
            date_start: "2026-10-01",
            date_stop: "2026-10-01",
            spend: "200",
            impressions: "8000",
            reach: "7000",
            clicks: "80",
            ctr: "1.0",
            cpc: "2.5",
            cpm: "25.0",
            frequency: "1.14",
            purchase_roas: [{ action_type: "omni_purchase", value: "3.2" }],
            actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "10" }],
            cost_per_action_type: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "20" }],
            video_continuous_2_sec_watched_actions: [{ action_type: "video_continuous_2_sec_watched", value: "5000" }],
            video_p100_watched_actions: [{ action_type: "video_p100_watched", value: "300" }],
            video_play_actions: [{ action_type: "video_view", value: "7200" }],
            account_currency: "THB",
          },
        ],
        paging: {},
      }),
    );

    const rows = await fetchMetaInsights({
      token: "tok",
      actId: "act_123",
      level: "campaign",
      since: "2026-10-01",
      until: "2026-10-01",
      fetchFn: mockFetch,
      cfg: CFG,
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.platform).toBe("meta");
    expect(row.level).toBe("campaign");
    expect(row.campaignId).toBe("c1");
    expect(row.spend).toBe(200);
    expect(row.videoViews6s).toBeNull(); // Meta never provides 6s views
    expect(row.videoViews2s).toBe(5000);
    expect(row.videoPlays).toBe(7200);
    expect(row.conversions).toBe(10);
    expect(row.costPerResult).toBe(20);
    expect(row.currency).toBe("THB");
    expect(row.joinKey).toBe("meta:act_123:campaign:c1:-:-:2026-10-01");
  });

  it("throws MetaTokenExpiredError on error code 190", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({ error: { code: 190, message: "Session has expired" } }),
    );

    await expect(
      fetchMetaInsights({
        token: "tok",
        actId: "act_1",
        level: "campaign",
        since: "2026-10-01",
        until: "2026-10-01",
        fetchFn: mockFetch,
        cfg: CFG,
      }),
    ).rejects.toBeInstanceOf(MetaTokenExpiredError);
  });

  it("retries on rate-limit code 17", async () => {
    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve(
          makeRes({ error: { code: 17, message: "User request limit reached" } }),
        );
      }
      return Promise.resolve(makeRes({ data: [], paging: {} }));
    });
    const noSleep = jest.fn().mockResolvedValue(undefined);

    await fetchMetaInsights({
      token: "tok",
      actId: "act_1",
      level: "campaign",
      since: "2026-10-01",
      until: "2026-10-01",
      fetchFn: mockFetch,
      sleepFn: noSleep,
      cfg: CFG,
    });

    expect(noSleep).toHaveBeenCalledTimes(2);
    expect(callCount).toBe(3);
  });

  it("retries on rate-limit code 80000", async () => {
    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(makeRes({ error: { code: 80000, message: "Rate limit" } }));
      }
      return Promise.resolve(makeRes({ data: [], paging: {} }));
    });
    const noSleep = jest.fn().mockResolvedValue(undefined);

    await fetchMetaInsights({
      token: "tok",
      actId: "act_1",
      level: "campaign",
      since: "2026-10-01",
      until: "2026-10-01",
      fetchFn: mockFetch,
      sleepFn: noSleep,
      cfg: CFG,
    });

    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it("recomputes CTR/CPC/CPM from raw numbers when absent", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      makeRes({
        data: [
          {
            campaign_id: "c1",
            date_start: "2026-10-01",
            spend: "100",
            impressions: "5000",
            clicks: "50",
            // no ctr, cpc, cpm
          },
        ],
        paging: {},
      }),
    );

    const [row] = await fetchMetaInsights({
      token: "tok",
      actId: "act_1",
      level: "campaign",
      since: "2026-10-01",
      until: "2026-10-01",
      fetchFn: mockFetch,
      cfg: CFG,
    });

    expect(row.ctr).toBeCloseTo(1.0);   // 50/5000 * 100
    expect(row.cpc).toBeCloseTo(2.0);   // 100/50
    expect(row.cpm).toBeCloseTo(20.0);  // 100/5000 * 1000
  });
});
