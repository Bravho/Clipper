import { avatarVideoSettingsSchema } from "@/config/heygenVideoOptions";
import { HEYGEN_ASPECT_RATIOS } from "@/config/heygenAspectRatios";
import { z } from "zod";
import { AD_LAB_CONTENT_PURPOSES } from "./contentPurpose";
import { adsReportingStateSchema } from "./ads-reporting/adsReportingModel";

const channelSchema = z.enum(["tiktok", "instagram", "facebook", "youtube"]);

const channelSettingsSchema = z.object({
  publish: z.boolean(),
  // Defaulted so workspaces saved before account selection still parse.
  accountIds: z.array(z.string()).default([]),
  advertisingEnabled: z.boolean(),
  budgetType: z.enum(["daily", "total"]),
  budget: z.number(),
  durationDays: z.number().int().min(1).max(365).optional(),
  targetAudience: z.string(),
});

const avatarVoiceSchema = z.object({
  voiceId: z.string().max(1024),
  modelId: z.string().max(1024),
  chars: z.number().finite().nonnegative(),
  audioKey: z.string().max(1024),
  durationSec: z.number().finite().nonnegative().optional(),
  estCostUsd: z.number().finite().nonnegative(),
  // Speed/tone fields: absent on voices generated before these were introduced.
  // Old records parse cleanly — missing = legacy voice, treated as defaults.
  speedId: z.string().max(64).optional(),
  speed: z.number().finite().positive().optional(),
  toneId: z.string().max(64).optional(),
  createdAt: z.string(),
});

const avatarImageSchema = z.object({
  imageKey: z.string().max(1024),
  mimeType: z.string().max(256),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  consentConfirmedAt: z.string(),
  createdAt: z.string(),
});

const avatarVideoSchema = z.object({
  provider: z.literal("heygen"),
  // "avatar_iv" accepted for legacy stored drafts; new videos always write "avatar_v".
  engine: z.enum(["avatar_iv", "avatar_v"]),
  heygenVideoId: z.string().max(1024).optional(),
  jobToken: z.string().max(1024).optional(),
  idempotencyKey: z.string().max(1024),
  aspectRatio: z.enum(HEYGEN_ASPECT_RATIOS),
  resolution: z.literal("1080p"),
  status: z.enum(["submitting", "queued", "processing", "copying", "ready", "failed"]),
  error: z.string().max(2000).optional(),
  attempts: z.number().int().nonnegative(),
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  durationSec: z.number().finite().nonnegative().optional(),
  videoKey: z.string().max(1024).optional(),
  estCostUsd: z.number().finite().nonnegative(),
  audioAssetId: z.string().max(256).optional(),
  imageAssetId: z.string().max(256).optional(),
  assetToken: z.string().max(128).optional(),
  sourceAudioKey: z.string().max(1024).optional(),
  sourceImageKey: z.string().max(1024).optional(),
  lookId: z.string().max(256).optional(),
});

const avatarVideoEntrySchema = z.object({
  id: z.string().max(1024),
  kind: z.enum(["test", "production"]),
  voiceSource: z.enum(["elevenlabs", "twin_tts"]),
  aspectRatio: z.enum(HEYGEN_ASPECT_RATIOS).optional(),
  settings: avatarVideoSettingsSchema.optional(),
  lookId: z.string().max(256),
  lookName: z.string().max(1024).optional(),
  engine: z.enum(["avatar_iv", "avatar_v"]),
  idempotencyKey: z.string().max(1024),
  heygenVideoId: z.string().max(1024).optional(),
  jobToken: z.string().max(1024).optional(),
  status: z.enum(["submitting", "queued", "processing", "copying", "ready", "failed"]),
  durationSec: z.number().finite().nonnegative().optional(),
  estCostUsd: z.number().finite().nonnegative(),
  videoKey: z.string().max(1024).optional(),
  title: z.string().max(500).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().max(2000).optional(),
  attempts: z.number().int().nonnegative(),
  audioAssetId: z.string().max(256).optional(),
  assetToken: z.string().max(128).optional(),
  sourceAudioKey: z.string().max(1024).optional(),
});

const CREATION_STAGES = ["uploading", "upload_complete", "creating", "awaiting_consent", "training", "completed", "failed"] as const;

const twinCreationSchema = z.object({
  idempotencyKey: z.string().max(1024),
  name: z.string().max(1024),
  stage: z.enum(CREATION_STAGES),
  assetId: z.string().max(256).optional(),
  lookId: z.string().max(256).optional(),
  groupId: z.string().max(256).optional(),
  consentUrl: z.string().max(2048).optional(),
  consentUrlAt: z.string().optional(),
  error: z.string().max(2000).optional(),
  createdAt: z.string(),
});

const lookCreationSchema = z.object({
  idempotencyKey: z.string().max(1024),
  name: z.string().max(1024),
  stage: z.enum(CREATION_STAGES),
  groupId: z.string().max(256),
  assetId: z.string().max(256).optional(),
  lookId: z.string().max(256).optional(),
  consentUrl: z.string().max(2048).optional(),
  consentUrlAt: z.string().optional(),
  error: z.string().max(2000).optional(),
  createdAt: z.string(),
});

const draftAvatarSchema = z.object({
  scriptHash: z.string().max(1024),
  skippedAt: z.string().optional(),
  updatedAt: z.string(),
  voice: avatarVoiceSchema.optional(),
  image: avatarImageSchema.optional(),
  video: avatarVideoSchema.optional(),
  videos: z.array(avatarVideoEntrySchema).optional(),
  primaryVideoId: z.string().max(1024).optional(),
  twinCreation: twinCreationSchema.optional(),
  lookCreation: lookCreationSchema.optional(),
  lookOverrides: z.record(z.string(), z.string()).optional(),
});

export const workspaceSchema = z.object({
  brands: z.array(z.object({
    id: z.string(), name: z.string(), product: z.string(), audience: z.string(),
    // Product/service details (persisted key kept as "promise").
    promise: z.string(),
    // Legacy key, accepted and preserved (zod would otherwise strip it) so existing stored
    // values are not altered; no longer written by the UI or used anywhere.
    tone: z.string().optional(),
    createdAt: z.string(),
  })),
  drafts: z.array(z.object({
    id: z.string(), brandId: z.string(), mainMessage: z.string(), detailedContent: z.string(),
    presentationDirection: z.string(), objective: z.string(), duration: z.string(),
    contentPurpose: z.enum(AD_LAB_CONTENT_PURPOSES).optional(),
    scriptPlan: z.string().optional(), scriptPlanHtml: z.string().optional(),
    revisionComment: z.string().optional(),
    title: z.string(), mainHook: z.string(), hooks: z.string(),
    painPointsOrIntroduction: z.string(), content: z.string(), conversion: z.string(),
    solution: z.string(), closing: z.string(), channels: z.array(channelSchema),
    status: z.enum(["draft", "approved"]), updatedAt: z.string(),
    avatar: draftAvatarSchema.optional(),
  })),
  results: z.array(z.object({
    id: z.string(), brandId: z.string(), campaignName: z.string(), channel: channelSchema,
    spend: z.number(), revenue: z.number(), impressions: z.number(), views3s: z.number(),
    completedViews: z.number(), clicks: z.number(), conversions: z.number(), createdAt: z.string(),
  })),
  publishingPlans: z.array(z.object({
    id: z.string(), draftId: z.string(), brandId: z.string().optional(),
    videoStorageKey: z.string(), videoName: z.string(),
    videoSize: z.number(), videoType: z.string(), caption: z.string(),
    channelSettings: z.object({
      tiktok: channelSettingsSchema,
      instagram: channelSettingsSchema,
      facebook: channelSettingsSchema,
      youtube: channelSettingsSchema,
    }),
    status: z.enum(["draft", "ready"]), updatedAt: z.string(),
  })),
  socialAccounts: z.array(z.object({
    id: z.string(), brandId: z.string(), channel: channelSchema, platform: z.string(),
    platformLabel: z.string(), accountName: z.string(), accountUsername: z.string(),
    avatarUrl: z.string(), status: z.enum(["pending", "connected", "disconnected"]),
    linkedAt: z.string(),
  })).default([]),
  selectedBrandId: z.string(),
  // Server-side only. Optional so old stored data parses cleanly.
  adsReporting: adsReportingStateSchema.optional(),
});

export type WorkspaceInput = z.input<typeof workspaceSchema>;
export type WorkspaceOutput = z.output<typeof workspaceSchema>;
