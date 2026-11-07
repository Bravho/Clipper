import {
  rankByEfficiency,
  detectFatigue,
  comparePlatforms,
  budgetSuggestions,
} from "@/services/ad-lab/ads-reporting/analysis";
import type { NormalizedAdMetricRow } from "@/services/ad-lab/ads-reporting/adsReportingModel";

function row(overrides: Partial<NormalizedAdMetricRow> & { campaignId: string; date: string }): NormalizedAdMetricRow {
  const { campaignId, date, ...rest } = overrides;
  return {
    platform: "tiktok",
    accountId: "adv1",
    level: "campaign",
    campaignId,
    date,
    spend: 100,
    impressions: 10000,
    reach: null,
    clicks: 100,
    ctr: 1.0,
    cpc: 1.0,
    cpm: 10.0,
    frequency: null,
    videoViews2s: null,
    videoViews6s: null,
    videoViews100: null,
    conversions: null,
    costPerResult: null,
    roas: null,
    joinKey: `tiktok:adv1:campaign:${campaignId}:-:-:${date}`,
    ...rest,
  };
}

describe("rankByEfficiency", () => {
  it("sorts campaigns by cost per result ascending", () => {
    const rows = [
      row({ campaignId: "c1", date: "2026-10-01", spend: 200, conversions: 2, costPerResult: 100 }),
      row({ campaignId: "c2", date: "2026-10-01", spend: 300, conversions: 10, costPerResult: 30 }),
      row({ campaignId: "c3", date: "2026-10-01", spend: 100, conversions: 1, costPerResult: 100 }),
    ];
    const ranked = rankByEfficiency(rows, "campaign");
    expect(ranked[0].entityId).toBe("c2"); // cheapest CPR first
    expect(ranked[0].costPerResult).toBe(30);
  });

  it("falls back to CPC when no conversions", () => {
    const rows = [
      row({ campaignId: "c1", date: "2026-10-01", spend: 200, clicks: 10 }), // CPC=20
      row({ campaignId: "c2", date: "2026-10-01", spend: 100, clicks: 20 }), // CPC=5
    ];
    const ranked = rankByEfficiency(rows, "campaign");
    expect(ranked[0].entityId).toBe("c2");
  });

  it("calculates spend share correctly", () => {
    const rows = [
      row({ campaignId: "c1", date: "2026-10-01", spend: 300 }),
      row({ campaignId: "c2", date: "2026-10-01", spend: 700 }),
    ];
    const ranked = rankByEfficiency(rows, "campaign");
    const c1 = ranked.find((r) => r.entityId === "c1")!;
    const c2 = ranked.find((r) => r.entityId === "c2")!;
    expect(c1.spendShare).toBeCloseTo(0.3);
    expect(c2.spendShare).toBeCloseTo(0.7);
  });

  it("flags low_data entities under spend threshold", () => {
    const rows = [row({ campaignId: "c1", date: "2026-10-01", spend: 10 })];
    const [r] = rankByEfficiency(rows, "campaign");
    expect(r.lowData).toBe(true);
  });

  it("returns empty array for wrong level", () => {
    const rows = [row({ campaignId: "c1", date: "2026-10-01", level: "campaign" })];
    expect(rankByEfficiency(rows, "ad")).toHaveLength(0);
  });
});

describe("detectFatigue", () => {
  function makeRows(
    campaignId: string,
    days: Array<{ date: string; clicks: number; impressions: number; frequency?: number }>,
  ): NormalizedAdMetricRow[] {
    return days.map((d) =>
      row({
        campaignId,
        date: d.date,
        clicks: d.clicks,
        impressions: d.impressions,
        ctr: (d.clicks / d.impressions) * 100,
        frequency: d.frequency ?? null,
      }),
    );
  }

  it("detects fatigue when CTR drops ≥20% and frequency rises ≥20%", () => {
    const rows = makeRows("c1", [
      { date: "2026-10-01", clicks: 100, impressions: 5000, frequency: 1.0 }, // first half
      { date: "2026-10-02", clicks: 100, impressions: 5000, frequency: 1.0 },
      { date: "2026-10-03", clicks: 100, impressions: 5000, frequency: 1.0 },
      { date: "2026-10-04", clicks: 60, impressions: 5000, frequency: 1.3 }, // CTR drops ~40%, freq rises 30%
      { date: "2026-10-05", clicks: 60, impressions: 5000, frequency: 1.3 },
      { date: "2026-10-06", clicks: 60, impressions: 5000, frequency: 1.3 },
    ]);
    const signals = detectFatigue(rows, { minImpressions: 100 });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].ctrDropPct).toBeGreaterThanOrEqual(0.2);
  });

  it("does not flag when CTR drop is small", () => {
    const rows = makeRows("c1", [
      { date: "2026-10-01", clicks: 100, impressions: 5000, frequency: 1.0 },
      { date: "2026-10-02", clicks: 100, impressions: 5000, frequency: 1.0 },
      { date: "2026-10-03", clicks: 95, impressions: 5000, frequency: 1.1 }, // 5% drop
      { date: "2026-10-04", clicks: 95, impressions: 5000, frequency: 1.1 },
    ]);
    const signals = detectFatigue(rows, { minImpressions: 100 });
    expect(signals).toHaveLength(0);
  });

  it("returns empty for insufficient data", () => {
    expect(detectFatigue([], {})).toHaveLength(0);
    expect(detectFatigue([row({ campaignId: "c1", date: "2026-10-01" })], {})).toHaveLength(0);
  });
});

describe("comparePlatforms", () => {
  it("aggregates totals per platform", () => {
    const rows = [
      row({ campaignId: "c1", date: "2026-10-01", platform: "tiktok", spend: 100, impressions: 5000, clicks: 50 }),
      row({ campaignId: "c2", date: "2026-10-01", platform: "meta", spend: 200, impressions: 8000, clicks: 80 }),
    ];
    const comparison = comparePlatforms(rows);
    const tiktok = comparison.find((p) => p.platform === "tiktok")!;
    const meta = comparison.find((p) => p.platform === "meta")!;
    expect(tiktok.totalSpend).toBe(100);
    expect(meta.totalSpend).toBe(200);
    expect(tiktok.avgCtr).toBeCloseTo(1.0);
    expect(meta.avgCtr).toBeCloseTo(1.0);
  });

  it("returns empty for no rows", () => {
    expect(comparePlatforms([])).toHaveLength(0);
  });
});

describe("budgetSuggestions", () => {
  it("returns Thai-language suggestions that never contain action-like calls", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) =>
        row({
          campaignId: `c${i}`,
          date: "2026-10-01",
          spend: (i + 1) * 1000,
          conversions: i + 1,
          costPerResult: (i + 1) * 500,
        }),
      ),
    ];
    const suggestions = budgetSuggestions(rows, "campaign");
    for (const s of suggestions) {
      // Must not contain any auto-action verbs in English
      expect(s.suggestion).not.toMatch(/\bupdat(e|ing)\b/i);
      expect(s.suggestion).not.toMatch(/\bcreat(e|ing)\b/i);
      expect(s.suggestion).not.toMatch(/\bpaus(e|ing)\b/i);
      expect(s.suggestion).not.toMatch(/\bdelet(e|ing)\b/i);
      // Must contain the disclaimer
      expect(s.evidence).toContain("ระบบไม่เปลี่ยนงบหรือแคมเปญให้อัตโนมัติ");
    }
  });

  it("returns empty array for no rows", () => {
    expect(budgetSuggestions([], "campaign")).toHaveLength(0);
  });
});

describe("rankByEfficiency video views", () => {
  it("sums video plays per entity and computes cost per view", () => {
    const ranked = rankByEfficiency([
      row({ campaignId: "c1", date: "2026-10-01", spend: 100, videoPlays: 400 }),
      row({ campaignId: "c1", date: "2026-10-02", spend: 100, videoPlays: 600 }),
    ], "campaign");
    expect(ranked[0].totalVideoPlays).toBe(1000);
    expect(ranked[0].costPerView).toBeCloseTo(0.2);
  });
  it("keeps null (shown as '-') when no row has video data, including old rows without the field", () => {
    const ranked = rankByEfficiency([
      row({ campaignId: "c1", date: "2026-10-01", videoPlays: null }),
      row({ campaignId: "c1", date: "2026-10-02" }),
    ], "campaign");
    expect(ranked[0].totalVideoPlays).toBeNull();
    expect(ranked[0].costPerView).toBeNull();
  });
  it("zero plays gives views 0 but no cost per view", () => {
    const [r] = rankByEfficiency([row({ campaignId: "c1", date: "2026-10-01", videoPlays: 0 })], "campaign");
    expect(r.totalVideoPlays).toBe(0);
    expect(r.costPerView).toBeNull();
  });
  it("works at adset and ad level and does not change the sort order", () => {
    const base = { level: "adset" as const, adsetId: "s1" };
    const rows = [
      row({ campaignId: "c1", date: "2026-10-01", ...base, adsetId: "s1", spend: 200, conversions: 2, videoPlays: 10 }),
      row({ campaignId: "c1", date: "2026-10-01", ...base, adsetId: "s2", spend: 300, conversions: 10, videoPlays: 99999 }),
    ];
    const ranked = rankByEfficiency(rows, "adset");
    expect(ranked.map((r) => r.entityId)).toEqual(["s2", "s1"]); // still cost-per-result order
    expect(ranked[1].totalVideoPlays).toBe(10);
    const ads = rankByEfficiency([row({ campaignId: "c1", date: "2026-10-01", level: "ad", adsetId: "s1", adId: "a1", spend: 50, videoPlays: 500 })], "ad");
    expect(ads[0]).toMatchObject({ entityId: "a1", totalVideoPlays: 500, costPerView: 0.1 });
  });
});
