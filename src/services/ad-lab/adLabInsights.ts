/**
 * Ad Lab results analysis — pure functions, no I/O.
 *
 *   normalizeAdLabMetrics()  provider metrics (shape differs per platform) →
 *                            one funnel every channel can be compared on
 *   evaluateTarget()         one published post: engagement + cost-effectiveness
 *   compareChannels()        roll posts up per channel and rank the channels
 *   adLabChannelInsights()   plain-language (Thai) takeaways for the owner
 *
 * Unknown stays unknown: a metric a platform does not report is null, and a
 * ratio whose inputs are missing or zero is null — never a misleading 0.
 */

import type { AdLabChannel } from "@/domain/models/AdLab";
import type {
  AdLabNormalizedMetrics,
  AdLabPublicationTarget,
} from "@/domain/models/AdLabPublication";

type Raw = Record<string, unknown>;

function num(raw: Raw, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function sumKnown(...values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/** Convert a platform's metrics object into the common funnel. */
export function normalizeAdLabMetrics(
  platform: string,
  raw: Raw | null | undefined
): AdLabNormalizedMetrics {
  const m = raw ?? {};
  const p = platform.toLowerCase();

  if (p === "tiktok_business") {
    return {
      views: num(m, "video_views"),
      reach: num(m, "reach"),
      likes: num(m, "likes"),
      comments: num(m, "comments"),
      shares: num(m, "shares"),
      saves: num(m, "favorites"),
      clicks: sumKnown(
        num(m, "website_clicks"),
        num(m, "phone_number_clicks"),
        num(m, "email_clicks"),
        num(m, "address_clicks"),
        num(m, "app_download_clicks")
      ),
      follows: num(m, "new_followers"),
      avgWatchSeconds: num(m, "average_time_watched"),
      completionRate: num(m, "full_video_watched_rate"),
    };
  }

  if (p === "tiktok") {
    return {
      views: num(m, "view_count"),
      reach: null,
      likes: num(m, "like_count"),
      comments: num(m, "comment_count"),
      shares: num(m, "share_count"),
      saves: null,
      clicks: null,
      follows: null,
      avgWatchSeconds: null,
      completionRate: null,
    };
  }

  if (p === "instagram") {
    const avgMs = num(m, "ig_reels_avg_watch_time");
    return {
      views: num(m, "views"),
      reach: num(m, "reach"),
      likes: num(m, "likes"),
      comments: num(m, "comments"),
      shares: num(m, "shares"),
      saves: num(m, "saved"),
      clicks: null,
      follows: num(m, "follows"),
      avgWatchSeconds: avgMs === null ? null : avgMs / 1000,
      completionRate: null,
    };
  }

  if (p === "facebook") {
    const views = num(m, "video_views", "media_views");
    const complete = sumKnown(
      num(m, "video_complete_views_organic"),
      num(m, "video_complete_views_paid")
    );
    const avgMs = num(m, "video_avg_time_watched");
    return {
      views,
      reach: num(m, "reach"),
      likes: num(m, "reactions_total", "reactions_like"),
      comments: num(m, "comments"),
      shares: num(m, "shares"),
      saves: null,
      clicks: null,
      follows: null,
      avgWatchSeconds: avgMs === null ? null : avgMs / 1000,
      completionRate: complete !== null && views ? (complete / views) * 100 : null,
    };
  }

  if (p === "youtube") {
    return {
      views: num(m, "views"),
      reach: null,
      likes: num(m, "likes"),
      comments: num(m, "comments"),
      shares: num(m, "shares"),
      saves: null,
      clicks: null,
      follows: null,
      avgWatchSeconds: null,
      completionRate: null,
    };
  }

  // Any other platform: take the common names if present.
  return {
    views: num(m, "views", "video_views", "view_count", "impressions"),
    reach: num(m, "reach"),
    likes: num(m, "likes", "like_count"),
    comments: num(m, "comments", "comment_count"),
    shares: num(m, "shares", "share_count"),
    saves: num(m, "saves", "saved"),
    clicks: num(m, "clicks"),
    follows: num(m, "follows"),
    avgWatchSeconds: null,
    completionRate: null,
  };
}

/** Likes + comments + shares + saves (whatever the platform reports). */
export function engagementCount(metrics: AdLabNormalizedMetrics | null): number | null {
  if (!metrics) return null;
  return sumKnown(metrics.likes, metrics.comments, metrics.shares, metrics.saves);
}

const ratio = (top: number | null, bottom: number | null, scale = 1): number | null =>
  top !== null && bottom !== null && bottom > 0 ? (top / bottom) * scale : null;

export interface AdLabTargetEvaluation {
  views: number | null;
  reach: number | null;
  engagements: number | null;
  clicks: number | null;
  /** Engagements per view, %. */
  engagementRate: number | null;
  /** Clicks per view, %. */
  clickRate: number | null;
  spend: number;
  revenue: number;
  conversions: number;
  /** Cost per 1,000 views (THB). Null when nothing was spent. */
  cpm: number | null;
  /** Cost per view. */
  cpv: number | null;
  /** Cost per engagement. */
  cpe: number | null;
  /** Cost per click. */
  cpc: number | null;
  /** Cost per conversion (customer / order / booking). */
  cpa: number | null;
  /** Revenue ÷ spend. */
  roas: number | null;
}

type Economics = Pick<AdLabPublicationTarget, "metrics" | "spend" | "revenue" | "conversions">;

export function evaluateTarget(target: Economics): AdLabTargetEvaluation {
  const metrics = target.metrics;
  const views = metrics?.views ?? null;
  const engagements = engagementCount(metrics);
  const clicks = metrics?.clicks ?? null;
  const spend = Math.max(0, target.spend || 0);
  const revenue = Math.max(0, target.revenue || 0);
  const conversions = Math.max(0, target.conversions || 0);
  const paid = spend > 0 ? spend : null;

  return {
    views,
    reach: metrics?.reach ?? null,
    engagements,
    clicks,
    engagementRate: ratio(engagements, views, 100),
    clickRate: ratio(clicks, views, 100),
    spend,
    revenue,
    conversions,
    cpm: ratio(paid, views, 1000),
    cpv: ratio(paid, views),
    cpe: ratio(paid, engagements),
    cpc: ratio(paid, clicks),
    cpa: ratio(paid, conversions || null),
    roas: paid !== null ? revenue / paid : null,
  };
}

export interface AdLabChannelSummary extends AdLabTargetEvaluation {
  channel: AdLabChannel;
  posts: number;
  /** Posts that have metrics fetched at least once. */
  postsWithMetrics: number;
}

/** Sum posts per channel, then recompute every ratio from the totals. */
export function compareChannels(
  targets: Array<Economics & Pick<AdLabPublicationTarget, "channel" | "status">>
): AdLabChannelSummary[] {
  const byChannel = new Map<AdLabChannel, typeof targets>();
  for (const target of targets) {
    if (target.status !== "published") continue;
    const list = byChannel.get(target.channel) ?? [];
    list.push(target);
    byChannel.set(target.channel, list);
  }

  const summaries: AdLabChannelSummary[] = [];
  for (const [channel, list] of byChannel) {
    const withMetrics = list.filter((t) => t.metrics);
    const total = (pick: (m: AdLabNormalizedMetrics) => number | null) =>
      sumKnown(...withMetrics.map((t) => pick(t.metrics as AdLabNormalizedMetrics)));
    const metrics: AdLabNormalizedMetrics | null = withMetrics.length
      ? {
          views: total((m) => m.views),
          reach: total((m) => m.reach),
          likes: total((m) => m.likes),
          comments: total((m) => m.comments),
          shares: total((m) => m.shares),
          saves: total((m) => m.saves),
          clicks: total((m) => m.clicks),
          follows: total((m) => m.follows),
          avgWatchSeconds: null,
          completionRate: null,
        }
      : null;
    const evaluation = evaluateTarget({
      metrics,
      spend: list.reduce((s, t) => s + (t.spend || 0), 0),
      revenue: list.reduce((s, t) => s + (t.revenue || 0), 0),
      conversions: list.reduce((s, t) => s + (t.conversions || 0), 0),
    });
    summaries.push({ channel, posts: list.length, postsWithMetrics: withMetrics.length, ...evaluation });
  }
  return summaries.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
}

/** The best channel on one measure; lower-is-better for costs. */
export function bestChannel(
  summaries: AdLabChannelSummary[],
  key: "engagementRate" | "roas" | "cpe" | "cpv" | "cpa" | "views"
): AdLabChannelSummary | null {
  const lowerIsBetter = key === "cpe" || key === "cpv" || key === "cpa";
  const candidates = summaries.filter((s) => s[key] !== null);
  if (candidates.length < 2) return null; // a comparison needs two channels
  return candidates.reduce((best, s) => {
    const a = s[key] as number;
    const b = best[key] as number;
    return (lowerIsBetter ? a < b : a > b) ? s : best;
  });
}

const CHANNEL_NAMES: Record<AdLabChannel, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
};

/** Short, actionable takeaways. Heuristic starting points, not verdicts. */
export function adLabChannelInsights(summaries: AdLabChannelSummary[]): string[] {
  const insights: string[] = [];
  const measured = summaries.filter((s) => s.postsWithMetrics > 0);
  if (measured.length === 0) {
    return ["ยังไม่มีผลจากแพลตฟอร์ม: กด “อัปเดตผลล่าสุด” หลังโพสต์ขึ้นแล้วอย่างน้อยสองสามชั่วโมง"];
  }

  const engage = bestChannel(measured, "engagementRate");
  if (engage) {
    insights.push(
      `${CHANNEL_NAMES[engage.channel]} มี engagement rate สูงสุด (${engage.engagementRate!.toFixed(1)}%) — ใช้เป็นช่องทางทดสอบ hook ใหม่ก่อน`
    );
  }
  const cheapest = bestChannel(measured, "cpe");
  if (cheapest) {
    insights.push(
      `${CHANNEL_NAMES[cheapest.channel]} ได้ engagement ถูกที่สุด (฿${cheapest.cpe!.toFixed(2)} ต่อครั้ง) — พิจารณาย้ายงบมาที่ช่องทางนี้`
    );
  }
  const roas = bestChannel(measured, "roas");
  if (roas) {
    insights.push(
      `${CHANNEL_NAMES[roas.channel]} ให้ ROAS ดีที่สุด (${roas.roas!.toFixed(2)}x) — ช่องทางที่เปลี่ยนเป็นยอดขายได้จริง`
    );
  }
  for (const s of measured) {
    if (s.roas !== null && s.roas < 1) {
      insights.push(
        `${CHANNEL_NAMES[s.channel]} ยังขาดทุน (ROAS ${s.roas.toFixed(2)}x): ปรับ CTA/ข้อเสนอ หรือลดงบจนกว่าจะดีขึ้น`
      );
    }
    if (s.engagementRate !== null && s.views !== null && s.views >= 500 && s.engagementRate < 1) {
      insights.push(
        `${CHANNEL_NAMES[s.channel]} มีคนเห็นแต่ไม่มีปฏิสัมพันธ์ (<1%): ทดลองเปิดคลิปด้วยคำถามหรือ pain point ที่ชัดขึ้น`
      );
    }
  }
  if (summaries.every((s) => s.spend === 0)) {
    insights.push("ใส่ค่าโฆษณาที่ใช้จริงและยอดขายที่ได้ ในแต่ละโพสต์ เพื่อดูความคุ้มค่า (CPM, CPE, ROAS)");
  }
  if (insights.length === 0) {
    insights.push("โพสต์อย่างน้อยสองช่องทางเพื่อเปรียบเทียบว่าช่องทางไหนคุ้มค่ากว่า");
  }
  return insights;
}
