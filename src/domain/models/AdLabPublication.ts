import type { AdLabChannel } from "./AdLab";
import type { AdLabAdsLink } from "./AdLabAdTargeting";

/**
 * Ad Lab real publishing — one video sent to several connected accounts, and
 * what happened to it on each platform. Stored in PostgreSQL (migration 039),
 * not in the JSON workspace, because the server is the authority on outcomes.
 */

export type AdLabPublicationStatus =
  | "sending"
  | "processing"
  | "published"
  | "partially_failed"
  | "failed";

export type AdLabTargetStatus = "pending" | "published" | "failed";

/**
 * Platform metrics reduced to one funnel every channel can be compared on.
 * A field is null when that platform does not report it (e.g. TikTok's
 * consumer API has no reach) — null means "unknown", never zero.
 */
export interface AdLabNormalizedMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** Clicks out of the post (website / link / profile-to-site), when reported. */
  clicks: number | null;
  /** New followers attributed to the post. */
  follows: number | null;
  /** Average watch time per view, in seconds. */
  avgWatchSeconds: number | null;
  /** Share of views that watched to the end, 0–100. */
  completionRate: number | null;
}

export interface AdLabPublicationTarget {
  id: string;
  publicationId: string;
  channel: AdLabChannel;
  connectionId: string;
  providerAccountId: string;
  platform: string;
  accountLabel: string;
  status: AdLabTargetStatus;
  platformPostId: string | null;
  platformUrl: string | null;
  error: string | null;
  publishedAt: string | null;
  plannedBudget: number;
  spend: number;
  revenue: number;
  conversions: number;
  metrics: AdLabNormalizedMetrics | null;
  metricsFetchedAt: string | null;
  /** TikTok Ads Manager / Marketing API link (draft/paused only from RClipper). */
  ads: AdLabAdsLink | null;
}

export interface AdLabPublication {
  id: string;
  ownerId: string;
  brandId: string;
  draftId: string;
  planId: string | null;
  campaignName: string;
  caption: string;
  videoKey: string;
  videoName: string;
  providerPostId: string | null;
  status: AdLabPublicationStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  targets: AdLabPublicationTarget[];
}

/** Roll per-destination outcomes up into the publication's status. */
export function aggregateAdLabPublicationStatus(
  targets: Pick<AdLabPublicationTarget, "status">[]
): AdLabPublicationStatus {
  if (targets.length === 0) return "failed";
  const published = targets.filter((t) => t.status === "published").length;
  const failed = targets.filter((t) => t.status === "failed").length;
  if (published === targets.length) return "published";
  if (failed === targets.length) return "failed";
  if (published + failed === targets.length) return "partially_failed";
  return "processing";
}
