import type { AdLabAdTargeting } from "./AdLabAdTargeting";

export const AD_LAB_CHANNELS = [
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
] as const;

export type AdLabChannel = (typeof AD_LAB_CHANNELS)[number];
export type AdLabScriptStatus = "draft" | "approved";

export interface AdLabBrand {
  id: string;
  name: string;
  product: string;
  audience: string;
  promise: string;
  tone: string;
  createdAt: string;
}

export interface AdLabScriptDraft {
  id: string;
  brandId: string;
  mainMessage: string;
  detailedContent: string;
  presentationDirection: string;
  objective: string;
  duration: string;
  /** Canonical full speaking script shown in the single Script & Scene Plan editor. */
  scriptPlan?: string;
  /** Sanitized presentation markup for user-applied emphasis and font sizes. */
  scriptPlanHtml?: string;
  /** User feedback retained with the draft for AI-assisted revisions. */
  revisionComment?: string;
  title: string;
  mainHook: string;
  hooks: string;
  painPointsOrIntroduction: string;
  content: string;
  conversion: string;
  solution: string;
  closing: string;
  channels: AdLabChannel[];
  status: AdLabScriptStatus;
  updatedAt: string;
}

/**
 * A social account connected through the Channel Management OAuth flow and
 * attached to one Ad Lab brand.
 *
 * SECURITY: display metadata and the connection id only. Tokens are dropped at
 * the provider boundary and never reach the Ad Lab workspace payload.
 */
export interface AdLabSocialAccount {
  /** `social_connections.id` from the Channel Management connection. */
  id: string;
  brandId: string;
  /** Ad Lab channel the account publishes to. */
  channel: AdLabChannel;
  /** Provider platform key, e.g. "tiktok_business", kept for display. */
  platform: string;
  platformLabel: string;
  accountName: string;
  accountUsername: string;
  avatarUrl: string;
  /** Connection health reported by the provider at link time. */
  status: "pending" | "connected" | "disconnected";
  linkedAt: string;
}

export interface AdLabChannelPublishingSettings {
  publish: boolean;
  /** Ids of the AdLabSocialAccount rows this channel publishes to. */
  accountIds: string[];
  /**
   * Paid promotion PLAN for this channel. Ad Lab does not buy ads or take
   * payment: the owner pays the platform (TikTok Promote, Meta boost, Google
   * Ads) themselves. These values become the target's planned budget, so the
   * Analyze tab can compare cost-effectiveness against what was planned.
   */
  advertisingEnabled: boolean;
  /** "daily": `budget` is per day × durationDays; "total": `budget` is the whole run. */
  budgetType: "daily" | "total";
  budget: number;
  /** Promotion length in days. Absent on plans saved before it existed (treated as 7). */
  durationDays?: number;
  targetAudience: string;
  /** Rich TikTok Ads Manager-style targeting (plan). Absent on older plans. */
  adTargeting?: AdLabAdTargeting | null;
}

export interface AdLabPublishingPlan {
  id: string;
  draftId: string;
  /** Brand the plan belongs to. Absent on plans saved before brand filtering. */
  brandId?: string;
  videoStorageKey: string;
  videoName: string;
  videoSize: number;
  videoType: string;
  caption: string;
  channelSettings: Record<AdLabChannel, AdLabChannelPublishingSettings>;
  /** "draft" while incomplete; "ready" once it has a video, caption and accounts. */
  status: "draft" | "ready";
  updatedAt: string;
}

export interface AdLabAdResult {
  id: string;
  brandId: string;
  campaignName: string;
  channel: AdLabChannel;
  spend: number;
  revenue: number;
  impressions: number;
  views3s: number;
  completedViews: number;
  clicks: number;
  conversions: number;
  createdAt: string;
}

/** Complete lightweight Ad Lab state persisted per signed-in owner. */
export interface AdLabStore {
  brands: AdLabBrand[];
  drafts: AdLabScriptDraft[];
  results: AdLabAdResult[];
  publishingPlans: AdLabPublishingPlan[];
  socialAccounts: AdLabSocialAccount[];
  selectedBrandId: string;
}
