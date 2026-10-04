import {
  adLabChannelInsights,
  bestChannel,
  compareChannels,
  engagementCount,
  evaluateTarget,
  normalizeAdLabMetrics,
} from "@/services/ad-lab/adLabInsights";
import type { AdLabNormalizedMetrics } from "@/domain/models/AdLabPublication";

const metrics = (over: Partial<AdLabNormalizedMetrics>): AdLabNormalizedMetrics => ({
  views: null, reach: null, likes: null, comments: null, shares: null, saves: null,
  clicks: null, follows: null, avgWatchSeconds: null, completionRate: null, ...over,
});

describe("normalizeAdLabMetrics", () => {
  it("maps TikTok Business, summing every click type", () => {
    const m = normalizeAdLabMetrics("tiktok_business", {
      video_views: 1000, reach: 800, likes: 50, comments: 5, shares: 3, favorites: 2,
      website_clicks: 10, phone_number_clicks: 2, email_clicks: 0, address_clicks: 1, app_download_clicks: 0,
      new_followers: 4, average_time_watched: 7.5, full_video_watched_rate: 22,
    });
    expect(m).toMatchObject({ views: 1000, reach: 800, saves: 2, clicks: 13, follows: 4, avgWatchSeconds: 7.5, completionRate: 22 });
  });

  it("maps TikTok consumer counts and leaves the rest unknown", () => {
    const m = normalizeAdLabMetrics("tiktok", { view_count: 500, like_count: 20, comment_count: 2, share_count: 1 });
    expect(m).toMatchObject({ views: 500, likes: 20, comments: 2, shares: 1, reach: null, clicks: null });
  });

  it("converts Instagram watch time from ms to seconds", () => {
    const m = normalizeAdLabMetrics("instagram", { views: 300, reach: 250, saved: 9, ig_reels_avg_watch_time: 4200 });
    expect(m).toMatchObject({ views: 300, saves: 9, avgWatchSeconds: 4.2 });
  });

  it("derives Facebook completion from organic + paid complete views", () => {
    const m = normalizeAdLabMetrics("facebook", {
      video_views: 200, reactions_total: 30, video_complete_views_organic: 30, video_complete_views_paid: 10,
    });
    expect(m.likes).toBe(30);
    expect(m.completionRate).toBeCloseTo(20);
  });

  it("maps YouTube and tolerates numeric strings", () => {
    expect(normalizeAdLabMetrics("youtube", { views: "1200", likes: 40, comments: 3 })).toMatchObject({ views: 1200, likes: 40 });
  });

  it("returns all-unknown for missing metrics", () => {
    expect(normalizeAdLabMetrics("youtube", null).views).toBeNull();
  });
});

describe("evaluateTarget", () => {
  it("computes engagement and cost-effectiveness", () => {
    const e = evaluateTarget({
      metrics: metrics({ views: 2000, likes: 80, comments: 10, shares: 6, saves: 4, clicks: 40 }),
      spend: 500, revenue: 1500, conversions: 5,
    });
    expect(e.engagements).toBe(100);
    expect(e.engagementRate).toBeCloseTo(5);
    expect(e.clickRate).toBeCloseTo(2);
    expect(e.cpm).toBeCloseTo(250);
    expect(e.cpv).toBeCloseTo(0.25);
    expect(e.cpe).toBeCloseTo(5);
    expect(e.cpc).toBeCloseTo(12.5);
    expect(e.cpa).toBeCloseTo(100);
    expect(e.roas).toBeCloseTo(3);
  });

  it("keeps cost ratios unknown for an organic (unpaid) post", () => {
    const e = evaluateTarget({ metrics: metrics({ views: 100, likes: 5 }), spend: 0, revenue: 0, conversions: 0 });
    expect(e.cpm).toBeNull();
    expect(e.roas).toBeNull();
    expect(e.engagementRate).toBeCloseTo(5);
  });

  it("does not invent zero when metrics are missing", () => {
    const e = evaluateTarget({ metrics: null, spend: 100, revenue: 0, conversions: 0 });
    expect(e.views).toBeNull();
    expect(e.cpv).toBeNull();
    expect(engagementCount(null)).toBeNull();
  });
});

describe("compareChannels", () => {
  const targets = [
    { channel: "tiktok" as const, status: "published" as const, spend: 100, revenue: 300, conversions: 3, metrics: metrics({ views: 1000, likes: 50 }) },
    { channel: "tiktok" as const, status: "published" as const, spend: 100, revenue: 100, conversions: 1, metrics: metrics({ views: 1000, likes: 30 }) },
    { channel: "instagram" as const, status: "published" as const, spend: 100, revenue: 50, conversions: 0, metrics: metrics({ views: 500, likes: 50 }) },
    { channel: "youtube" as const, status: "failed" as const, spend: 0, revenue: 0, conversions: 0, metrics: null },
  ];

  it("rolls posts up per channel and recomputes ratios from totals", () => {
    const summaries = compareChannels(targets);
    expect(summaries.map((s) => s.channel)).toEqual(["tiktok", "instagram"]); // failed posts excluded
    const tiktok = summaries[0];
    expect(tiktok.posts).toBe(2);
    expect(tiktok.views).toBe(2000);
    expect(tiktok.engagementRate).toBeCloseTo(4);
    expect(tiktok.roas).toBeCloseTo(2);
  });

  it("picks the best channel per measure, lower-is-better for costs", () => {
    const summaries = compareChannels(targets);
    expect(bestChannel(summaries, "engagementRate")?.channel).toBe("instagram");
    expect(bestChannel(summaries, "roas")?.channel).toBe("tiktok");
    expect(bestChannel(summaries, "cpe")?.channel).toBe("instagram");
    expect(bestChannel(summaries.slice(0, 1), "roas")).toBeNull();
  });

  it("produces readable insights, including a loss warning", () => {
    const insights = adLabChannelInsights(compareChannels(targets));
    expect(insights.some((i) => i.includes("Instagram") && i.includes("ขาดทุน"))).toBe(true);
    expect(insights.length).toBeGreaterThan(1);
  });

  it("asks for a refresh when nothing has metrics yet", () => {
    const insights = adLabChannelInsights(compareChannels([{ ...targets[0], metrics: null }]));
    expect(insights[0]).toContain("อัปเดตผลล่าสุด");
  });
});
