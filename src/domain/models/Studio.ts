export const STUDIO_CHANNELS = [
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
] as const;

export type StudioChannel = (typeof STUDIO_CHANNELS)[number];
export type StudioScriptStatus = "draft" | "approved";

export interface StudioBrand {
  id: string;
  name: string;
  product: string;
  audience: string;
  promise: string;
  tone: string;
  createdAt: string;
}

export interface StudioScriptDraft {
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
  channels: StudioChannel[];
  status: StudioScriptStatus;
  updatedAt: string;
}

export interface StudioChannelPublishingSettings {
  publish: boolean;
  advertisingEnabled: boolean;
  budgetType: "daily" | "total";
  budget: number;
  targetAudience: string;
}

export interface StudioPublishingPlan {
  id: string;
  draftId: string;
  videoStorageKey: string;
  videoName: string;
  videoSize: number;
  videoType: string;
  caption: string;
  channelSettings: Record<StudioChannel, StudioChannelPublishingSettings>;
  status: "ready";
  updatedAt: string;
}

export interface StudioAdResult {
  id: string;
  brandId: string;
  campaignName: string;
  channel: StudioChannel;
  spend: number;
  revenue: number;
  impressions: number;
  views3s: number;
  completedViews: number;
  clicks: number;
  conversions: number;
  createdAt: string;
}

/** Complete lightweight Studio state persisted per signed-in owner. */
export interface StudioStore {
  brands: StudioBrand[];
  drafts: StudioScriptDraft[];
  results: StudioAdResult[];
  publishingPlans: StudioPublishingPlan[];
  selectedBrandId: string;
}
