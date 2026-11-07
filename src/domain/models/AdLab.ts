import type { AvatarVideoSettings } from "@/config/heygenVideoOptions";
import type { HeyGenAspectRatio } from "@/config/heygenAspectRatios";
import type { AdLabAdTargeting } from "./AdLabAdTargeting";
import type { AdLabContentPurpose } from "@/services/ad-lab/contentPurpose";

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
  /**
   * Key kept as `promise` for storage/wire compatibility (studio_workspaces.data JSON)
   * but now holds product/service details: what it is, features, benefits, price/packages.
   */
  promise: string;
  // Legacy brands saved before tone was removed may still carry a `tone` key in the
  // stored JSON; it is ignored and intentionally not deleted from stored records.
  createdAt: string;
}

export type AdLabAvatarVideoStatus = "submitting" | "queued" | "processing" | "copying" | "ready" | "failed";

export type AdLabVideoKind = "test" | "production";
export type AdLabVideoVoiceSource = "elevenlabs" | "twin_tts";

/** A single video generation entry in the avatar videos array (multi-video manager). */
export interface AdLabAvatarVideoEntry {
  id: string;
  kind: AdLabVideoKind;
  voiceSource: AdLabVideoVoiceSource;
  lookId: string;
  lookName?: string;
  engine: "avatar_iv" | "avatar_v";
  idempotencyKey: string;
  heygenVideoId?: string;
  jobToken?: string;
  status: AdLabAvatarVideoStatus;
  durationSec?: number;
  estCostUsd: number;
  videoKey?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  attempts: number;
  /** Output aspect ratio; absent on entries created before the selector (treat as 9:16). */
  aspectRatio?: HeyGenAspectRatio;
  /** Applied HeyGen advanced settings (non-default only); absent = HeyGen defaults. */
  settings?: AvatarVideoSettings;
  audioAssetId?: string;
  assetToken?: string;
  sourceAudioKey?: string;
}

export interface AdLabAvatarVoice {
  voiceId: string;
  modelId: string;
  chars: number;
  audioKey: string;
  durationSec?: number;
  estCostUsd: number;
  /** Speed option used when generating. Absent on voices created before this field was added. */
  speedId?: string;
  /** Resolved speed multiplier (0.7–1.2). Absent on legacy voices. */
  speed?: number;
  /** Tone preset used when generating. Absent on voices created before this field was added. */
  toneId?: string;
  createdAt: string;
}

export interface AdLabAvatarImage {
  imageKey: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  consentConfirmedAt: string;
  createdAt: string;
}

export interface AdLabAvatarVideo {
  provider: "heygen";
  /** "avatar_iv" kept for legacy parse compatibility; new videos use "avatar_v". */
  engine: "avatar_iv" | "avatar_v";
  heygenVideoId?: string;
  jobToken?: string;
  idempotencyKey: string;
  aspectRatio: HeyGenAspectRatio;
  resolution: "1080p";
  status: AdLabAvatarVideoStatus;
  error?: string;
  attempts: number;
  requestedAt: string;
  completedAt?: string;
  durationSec?: number;
  videoKey?: string;
  estCostUsd: number;
  /** HeyGen audio asset ID saved after prepareVideoAssets so resend skips re-uploading. */
  audioAssetId?: string;
  /** @deprecated Avatar IV photo asset ID; kept for parsing old drafts. */
  imageAssetId?: string;
  /** HMAC proof token binding the audio asset ID to this owner/draft. */
  assetToken?: string;
  /** The voice audioKey that was active when audioAssetId was created. */
  sourceAudioKey?: string;
  /** @deprecated Avatar IV source image key; kept for parsing old drafts. */
  sourceImageKey?: string;
  /** Avatar V Digital Twin look ID used when creating this video. */
  lookId?: string;
}

export type TwinCreationStage =
  | "uploading"
  | "upload_complete"
  | "creating"
  | "awaiting_consent"
  | "training"
  | "completed"
  | "failed";

/** Same stages reused for an "add portrait look to existing twin" attempt. */
export type LookCreationStage = TwinCreationStage;

/** Persisted state for a Digital Twin creation attempt (survives page reload). */
export interface AdLabTwinCreation {
  idempotencyKey: string;
  name: string;
  stage: TwinCreationStage;
  assetId?: string;
  lookId?: string;
  groupId?: string;
  consentUrl?: string;
  /** ISO timestamp when the current consentUrl was issued. */
  consentUrlAt?: string;
  error?: string;
  createdAt: string;
}

/**
 * Persisted state for an "add portrait look to existing twin" attempt.
 * Separate from twinCreation so both flows can coexist.
 */
export interface AdLabLookCreation {
  idempotencyKey: string;
  name: string;
  stage: LookCreationStage;
  /** The avatar group (twin identity) this look is being added to. */
  groupId: string;
  assetId?: string;
  /** New look ID assigned by HeyGen after successful creation. */
  lookId?: string;
  consentUrl?: string;
  consentUrlAt?: string;
  error?: string;
  createdAt: string;
}

export interface AdLabDraftAvatar {
  scriptHash: string;
  skippedAt?: string;
  updatedAt: string;
  voice?: AdLabAvatarVoice;
  image?: AdLabAvatarImage;
  /** @deprecated Single-video legacy field. Kept for backward compat; new code writes `videos` instead. */
  video?: AdLabAvatarVideo;
  /** Multi-video manager: array of all generated video entries. */
  videos?: AdLabAvatarVideoEntry[];
  /** ID of the video entry to use for Publishing (points to an AdLabAvatarVideoEntry.id). */
  primaryVideoId?: string;
  /** In-progress Digital Twin creation attempt. Cleared when stage=completed/failed+dismissed. */
  twinCreation?: AdLabTwinCreation;
  /** In-progress "add portrait look" attempt. Cleared when stage=completed/failed+dismissed. */
  lookCreation?: AdLabLookCreation;
  /** Manual look-picker overrides per group+ratio, keyed `${groupId}:${ratio}`. */
  lookOverrides?: Record<string, string>;
}

export interface AdLabScriptDraft {
  id: string;
  brandId: string;
  mainMessage: string;
  detailedContent: string;
  presentationDirection: string;
  objective: string;
  duration: string;
  /** Missing on old drafts; treat as advertisement. */
  contentPurpose?: AdLabContentPurpose;
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
  avatar?: AdLabDraftAvatar;
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
  /** Ads-reporting integration state (server-side only; stripped from GET responses). */
  adsReporting?: import("@/services/ad-lab/ads-reporting/adsReportingModel").AdsReportingState;
}
