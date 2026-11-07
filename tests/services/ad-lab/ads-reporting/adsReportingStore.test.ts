import {
  mergeMetrics,
  saveOAuthState,
  consumeOAuthState,
  buildJoinKey,
  METRICS_MAX_DAYS,
  METRICS_CAP,
} from "@/services/ad-lab/ads-reporting/adsReportingModel";
import type { NormalizedAdMetricRow, AdsOAuthState } from "@/services/ad-lab/ads-reporting/adsReportingModel";

function makeRow(overrides: Partial<NormalizedAdMetricRow> & { date: string; campaignId?: string }): NormalizedAdMetricRow {
  const campaignId = overrides.campaignId ?? "c1";
  const base: NormalizedAdMetricRow = {
    platform: "tiktok",
    accountId: "adv1",
    level: "campaign",
    date: overrides.date,
    campaignId,
    spend: 10,
    impressions: 1000,
    reach: null,
    clicks: 10,
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
    joinKey: buildJoinKey({ platform: "tiktok", accountId: "adv1", level: "campaign", campaignId, date: overrides.date }),
  };
  return { ...base, ...overrides };
}

describe("buildJoinKey", () => {
  it("builds correct key", () => {
    expect(buildJoinKey({ platform: "meta", accountId: "act_1", level: "ad", campaignId: "c1", adsetId: "as1", adId: "a1", date: "2026-10-01" }))
      .toBe("meta:act_1:ad:c1:as1:a1:2026-10-01");
  });

  it("uses dash for missing optional ids", () => {
    expect(buildJoinKey({ platform: "tiktok", accountId: "adv1", level: "campaign", campaignId: "c1", date: "2026-10-01" }))
      .toBe("tiktok:adv1:campaign:c1:-:-:2026-10-01");
  });
});

describe("mergeMetrics", () => {
  it("deduplicates by joinKey — new row wins", () => {
    const old = makeRow({ date: "2026-10-01", spend: 10 });
    const updated = makeRow({ date: "2026-10-01", spend: 99 }); // same joinKey
    const merged = mergeMetrics([old], [updated], new Date("2026-10-15"));
    expect(merged).toHaveLength(1);
    expect(merged[0].spend).toBe(99);
  });

  it("removes rows older than METRICS_MAX_DAYS", () => {
    const now = new Date("2026-10-15");
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - METRICS_MAX_DAYS);
    const oldDate = new Date(cutoff);
    oldDate.setDate(oldDate.getDate() - 1);
    const oldRow = makeRow({ date: oldDate.toISOString().slice(0, 10) });
    const newRow = makeRow({ date: "2026-10-14", campaignId: "c2" });

    const merged = mergeMetrics([oldRow], [newRow], now);
    expect(merged.some((r) => r.campaignId === "c2")).toBe(true);
    expect(merged.some((r) => r.joinKey === oldRow.joinKey)).toBe(false);
  });

  it("caps at METRICS_CAP rows, keeping newest", () => {
    const now = new Date("2026-10-15");
    // Create METRICS_CAP + 10 rows all within the 120-day window, with unique joinKeys
    // Use 10 dates × (METRICS_CAP/10 + 1) campaigns per date
    const perDay = Math.ceil((METRICS_CAP + 10) / 10);
    const rows: ReturnType<typeof makeRow>[] = [];
    for (let d = 0; d < 10 && rows.length < METRICS_CAP + 10; d++) {
      const date = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
      for (let c = 0; c < perDay && rows.length < METRICS_CAP + 10; c++) {
        rows.push(makeRow({ campaignId: `c${d}_${c}`, date }));
      }
    }
    const merged = mergeMetrics(rows, [], now);
    expect(merged).toHaveLength(METRICS_CAP);
  });
});

describe("OAuth state management", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  function makeState(state: string, platform: "tiktok" | "meta" = "tiktok", createdAt?: string): AdsOAuthState {
    return { state, platform, ownerId: "u1", createdAt: createdAt ?? now.toISOString() };
  }

  it("saves new OAuth state and prunes expired ones", () => {
    const expired = makeState("old", "meta", new Date(now.getTime() - 11 * 60 * 1000).toISOString());
    const result = saveOAuthState([expired], makeState("new"), now);
    expect(result.some((s) => s.state === "old")).toBe(false);
    expect(result.some((s) => s.state === "new")).toBe(true);
  });

  it("consumes a valid state and removes it", () => {
    const states = [makeState("valid123")];
    const result = consumeOAuthState(states, "valid123", now);
    expect(result).toBeDefined();
    expect(result!.found.state).toBe("valid123");
    expect(result!.rest).toHaveLength(0);
  });

  it("returns undefined for expired state", () => {
    const expired = makeState("exp", "tiktok", new Date(now.getTime() - 11 * 60 * 1000).toISOString());
    const result = consumeOAuthState([expired], "exp", now);
    expect(result).toBeUndefined();
  });

  it("returns undefined for missing state", () => {
    const result = consumeOAuthState([makeState("other")], "missing", now);
    expect(result).toBeUndefined();
  });
});
