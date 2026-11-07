import { readOnlyAdsFetch, AdsReadOnlyViolation } from "@/services/ad-lab/ads-reporting/readOnlyAdsFetch";

const mockFetch = jest.fn();
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
});
afterEach(() => jest.resetAllMocks());

// ─── TikTok allowlist ─────────────────────────────────────────────────────────

describe("TikTok allowed", () => {
  it("allows POST /open_api/v1.3/oauth2/access_token/", async () => {
    await readOnlyAdsFetch(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
      { method: "POST" },
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows GET /open_api/v1.3/oauth2/advertiser/get/", async () => {
    await readOnlyAdsFetch(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows GET /open_api/v1.3/report/integrated/get/", async () => {
    await readOnlyAdsFetch(
      "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?advertiser_id=123",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("TikTok blocked", () => {
  it("blocks POST /open_api/v1.3/campaign/create/", async () => {
    await expect(
      readOnlyAdsFetch(
        "https://business-api.tiktok.com/open_api/v1.3/campaign/create/",
        { method: "POST" },
      ),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks GET /open_api/v1.3/campaign/create/", async () => {
    await expect(
      readOnlyAdsFetch("https://business-api.tiktok.com/open_api/v1.3/campaign/create/"),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks DELETE /open_api/v1.3/campaign/delete/", async () => {
    await expect(
      readOnlyAdsFetch(
        "https://business-api.tiktok.com/open_api/v1.3/campaign/delete/",
        { method: "DELETE" },
      ),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks POST to report endpoint (only GET allowed)", async () => {
    await expect(
      readOnlyAdsFetch(
        "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/",
        { method: "POST" },
      ),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Meta allowlist ───────────────────────────────────────────────────────────

describe("Meta allowed", () => {
  it("allows GET /v25.0/oauth/access_token", async () => {
    await readOnlyAdsFetch("https://graph.facebook.com/v25.0/oauth/access_token?client_id=1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows GET /v25.0/me", async () => {
    await readOnlyAdsFetch("https://graph.facebook.com/v25.0/me?access_token=tok");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows GET /v25.0/me/adaccounts", async () => {
    await readOnlyAdsFetch("https://graph.facebook.com/v25.0/me/adaccounts?fields=id");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows GET /v25.0/act_123/insights", async () => {
    await readOnlyAdsFetch("https://graph.facebook.com/v25.0/act_123456/insights?level=campaign");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("allows GET /v25.0/debug_token", async () => {
    await readOnlyAdsFetch("https://graph.facebook.com/v25.0/debug_token?input_token=tok");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("Meta blocked", () => {
  it("blocks POST /act_1/campaigns", async () => {
    await expect(
      readOnlyAdsFetch(
        "https://graph.facebook.com/v25.0/act_1/campaigns",
        { method: "POST" },
      ),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks GET with method=delete query param", async () => {
    await expect(
      readOnlyAdsFetch(
        "https://graph.facebook.com/v25.0/me/adaccounts?method=delete",
      ),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks DELETE anything on Meta", async () => {
    await expect(
      readOnlyAdsFetch(
        "https://graph.facebook.com/v25.0/act_1/insights",
        { method: "DELETE" },
      ),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks path containing 'create'", async () => {
    await expect(
      readOnlyAdsFetch("https://graph.facebook.com/v25.0/act_1/adcreatives"),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks path containing 'budget'", async () => {
    await expect(
      readOnlyAdsFetch("https://graph.facebook.com/v25.0/act_1/budget"),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks unknown host", async () => {
    await expect(
      readOnlyAdsFetch("https://evil.example.com/steal"),
    ).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("readOnlyAdsFetch extra hardening", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  it.each([
    ["http://graph.facebook.com/v25.0/me", {}],
    ["https://user:pw@graph.facebook.com/v25.0/me", {}],
    ["https://graph.facebook.com/v25.0/me", { headers: { "X-HTTP-Method-Override": "DELETE" } }],
    ["https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/", { headers: { "X-HTTP-Method": "POST" } }],
  ])("blocks %s before fetch", async (url, init) => {
    const f = jest.fn();
    global.fetch = f as unknown as typeof fetch;
    await expect(readOnlyAdsFetch(url, init as RequestInit)).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("results come from insights fields; campaign/adset object reads stay blocked", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  it.each([
    "https://graph.facebook.com/v25.0/act_1/campaigns?fields=objective",
    "https://graph.facebook.com/v25.0/act_1/adsets?fields=optimization_goal,promoted_object",
  ])("GET %s is not allowlisted (not needed: insights returns objective/optimization_goal/results)", async (url) => {
    const f = jest.fn();
    global.fetch = f as unknown as typeof fetch;
    await expect(readOnlyAdsFetch(url, { method: "GET" })).rejects.toBeInstanceOf(AdsReadOnlyViolation);
    expect(f).not.toHaveBeenCalled();
  });
});