import { extractMetaResult, resultLabel, normalizeIndicator, OPTIMIZATION_GOAL_TO_RESULT } from "@/services/ad-lab/ads-reporting/metaResults";
import { fetchMetaInsights } from "@/services/ad-lab/ads-reporting/metaAdsClient";
import { rankByEfficiency, comparePlatforms, summarizeResultsByType } from "@/services/ad-lab/ads-reporting/analysis";
import type { NormalizedAdMetricRow } from "@/services/ad-lab/ads-reporting/adsReportingModel";

const MSG = "onsite_conversion.messaging_conversation_started_7d";

describe("extractMetaResult", () => {
  it("prefers Meta's results/cost_per_result with indicator (Ads Manager Results)", () => {
    const r = extractMetaResult({
      spend: "780.78",
      optimization_goal: "REPLIES",
      results: [{ indicator: `actions:${MSG}`, values: [{ value: "1", attribution_windows: ["default"] }] }],
      cost_per_result: [{ indicator: `actions:${MSG}`, values: [{ value: "780.78", attribution_windows: ["default"] }] }],
      actions: [{ action_type: "lead", value: "15" }],
    });
    expect(r).toEqual({ resultType: MSG, results: 1, costPerResult: 780.78, source: "meta_results" });
  });

  it("indicator without values means 0 results (not the legacy 'lead' count)", () => {
    const r = extractMetaResult({
      spend: "396.84",
      optimization_goal: "LEAD_GENERATION",
      results: [{ indicator: "actions:onsite_conversion.lead_grouped" }],
      cost_per_result: [{ indicator: "actions:onsite_conversion.lead_grouped" }],
      actions: [{ action_type: "lead", value: "15" }],
    });
    expect(r).toEqual({ resultType: "onsite_conversion.lead_grouped", results: 0, costPerResult: null, source: "meta_results" });
  });

  it("uses the default attribution window value when several are present", () => {
    const r = extractMetaResult({
      spend: 100,
      results: [{ indicator: "actions:link_click", values: [{ value: "9", attribution_windows: ["7d_click"] }, { value: "5", attribution_windows: ["default"] }] }],
    });
    expect(r.results).toBe(5);
    expect(r.costPerResult).toBe(20); // spend / results when cost_per_result missing
  });

  it.each([
    ["CONVERSATIONS", MSG],
    ["LEAD_GENERATION", "onsite_conversion.lead_grouped"],
    ["OFFSITE_CONVERSIONS", "offsite_conversion.fb_pixel_purchase"],
    ["LINK_CLICKS", "link_click"],
    ["LANDING_PAGE_VIEWS", "landing_page_view"],
    ["POST_ENGAGEMENT", "post_engagement"],
  ])("falls back to optimization_goal %s -> %s via actions/cost_per_action_type", (goal, action) => {
    const r = extractMetaResult({
      spend: 200,
      optimization_goal: goal,
      actions: [{ action_type: action, value: "4" }, { action_type: "lead", value: "99" }],
      cost_per_action_type: [{ action_type: action, value: "50" }],
    });
    expect(r).toEqual({ resultType: action, results: 4, costPerResult: 50, source: "optimization_goal" });
    expect(OPTIMIZATION_GOAL_TO_RESULT[goal]).toBe(action);
  });

  it("THRUPLAY reads video_thruplay_watched_actions; REACH costs per 1,000", () => {
    expect(extractMetaResult({ spend: 30, optimization_goal: "THRUPLAY", video_thruplay_watched_actions: [{ action_type: "video_view", value: "60" }] }))
      .toEqual({ resultType: "video_thruplay_watched", results: 60, costPerResult: 0.5, source: "optimization_goal" });
    expect(extractMetaResult({ spend: 50, optimization_goal: "REACH", reach: "10000" }))
      .toEqual({ resultType: "reach", results: 10000, costPerResult: 5, source: "optimization_goal" });
  });

  it("legacy priority only when neither results nor a known goal exist", () => {
    const r = extractMetaResult({ spend: 90, actions: [{ action_type: "lead", value: "3" }] });
    expect(r).toEqual({ resultType: "lead", results: 3, costPerResult: 30, source: "legacy_priority" });
    expect(extractMetaResult({ spend: 10 })).toEqual({ resultType: null, results: null, costPerResult: null, source: null });
  });

  it("labels", () => {
    expect(resultLabel(MSG)).toEqual({ th: "เริ่มการสนทนาทางข้อความ", en: "Messaging conversations started" });
    expect(resultLabel("custom.x")).toEqual({ th: "custom.x", en: "custom.x" });
    expect(normalizeIndicator("actions:link_click")).toBe("link_click");
    expect(normalizeIndicator("reach")).toBe("reach");
  });
});

describe("fetchMetaInsights stores resultType + labels per row", () => {
  it("requests results/cost_per_result/objective/optimization_goal and normalizes them (GET only)", async () => {
    const fetchFn = jest.fn(async () => new Response(JSON.stringify({ data: [{
      campaign_id: "c1", campaign_name: "Msg", date_start: "2026-10-11", spend: "780.78", impressions: "2280", clicks: "45",
      objective: "OUTCOME_ENGAGEMENT", optimization_goal: "REPLIES",
      results: [{ indicator: `actions:${MSG}`, values: [{ value: "1", attribution_windows: ["default"] }] }],
      cost_per_result: [{ indicator: `actions:${MSG}`, values: [{ value: "780.78", attribution_windows: ["default"] }] }],
      actions: [{ action_type: "lead", value: "7" }],
    }] }), { status: 200 }));
    const rows = await fetchMetaInsights({
      token: "t", actId: "act_1", level: "campaign", since: "2026-10-01", until: "2026-10-17",
      fetchFn: fetchFn as never, sleepFn: async () => {},
      cfg: { appId: "", appSecret: "", redirectUri: "", graphApiVersion: "v25.0", oauthScopes: "ads_read" },
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const fields = new URL(url).searchParams.get("fields")!.split(",");
    expect(fields).toEqual(expect.arrayContaining(["results", "cost_per_result", "objective", "optimization_goal"]));
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
    expect(rows[0]).toMatchObject({
      conversions: 1, costPerResult: 780.78, resultType: MSG, resultLabelTh: "เริ่มการสนทนาทางข้อความ",
      resultLabelEn: "Messaging conversations started", resultSource: "meta_results",
      objective: "OUTCOME_ENGAGEMENT", optimizationGoal: "REPLIES",
    });
  });
});

function row(p: Partial<NormalizedAdMetricRow>): NormalizedAdMetricRow {
  return {
    platform: "meta", accountId: "act_1", level: "campaign", date: "2026-10-11", campaignId: "c1",
    spend: 0, impressions: 0, reach: null, clicks: 0, ctr: null, cpc: null, cpm: null, frequency: null,
    videoViews2s: null, videoViews6s: null, videoViews100: null, conversions: null, costPerResult: null, roas: null,
    joinKey: Math.random().toString(), ...p,
  };
}

describe("mixed result types are never summed", () => {
  const rows = [
    row({ campaignId: "a", spend: 100, conversions: 2, resultType: MSG }),
    row({ campaignId: "a", date: "2026-10-12", spend: 50, conversions: 1, resultType: MSG }),
    row({ campaignId: "b", spend: 300, conversions: 3, resultType: "onsite_conversion.lead_grouped" }),
    row({ campaignId: "c", spend: 40, conversions: 1, resultType: MSG }),
    row({ campaignId: "c", date: "2026-10-12", spend: 40, conversions: 9, resultType: "link_click" }),
  ];
  it("ranking keeps per-entity type and marks an entity with two types as mixed", () => {
    const r = rankByEfficiency(rows, "campaign");
    const a = r.find((x) => x.entityId === "a")!;
    expect(a).toMatchObject({ totalConversions: 3, costPerResult: 50, resultType: MSG, resultLabelTh: "เริ่มการสนทนาทางข้อความ" });
    const c = r.find((x) => x.entityId === "c")!;
    expect(c).toMatchObject({ resultType: "mixed", totalConversions: null, costPerResult: null });
  });
  it("summary gives per-type totals", () => {
    const s = summarizeResultsByType(rows);
    const msg = s.find((t) => t.resultType === MSG)!;
    expect(msg).toMatchObject({ results: 4, spend: 190, entities: 2 });
    expect(msg.costPerResult).toBeCloseTo(47.5);
    expect(s.map((t) => t.resultType).sort()).toEqual(["link_click", MSG, "onsite_conversion.lead_grouped"].sort());
  });
  it("platform comparison does not total mixed types", () => {
    const [pc] = comparePlatforms(rows);
    expect(pc.resultsMixed).toBe(true);
    expect(pc.totalConversions).toBeNull();
    expect(pc.avgCostPerResult).toBeNull();
    const [single] = comparePlatforms(rows.filter((r) => r.campaignId === "a"));
    expect(single).toMatchObject({ resultsMixed: false, totalConversions: 3, resultTypes: [MSG] });
  });
});