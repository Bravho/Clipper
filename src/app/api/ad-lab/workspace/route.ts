import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/helpers";
import { isAdLabEnabledFor } from "@/config/adLab";
import { adLabWorkspaceRepository } from "@/repositories/index";
import { isTransientPostgresConnectionError } from "@/lib/postgresErrors";

const channelSchema = z.enum(["tiktok", "instagram", "facebook", "youtube"]);
const channelSettingsSchema = z.object({
  publish: z.boolean(),
  // Defaulted so workspaces saved before account selection still parse.
  accountIds: z.array(z.string()).default([]),
  advertisingEnabled: z.boolean(),
  budgetType: z.enum(["daily", "total"]),
  budget: z.number(),
  targetAudience: z.string(),
});
const workspaceSchema = z.object({
  brands: z.array(z.object({
    id: z.string(), name: z.string(), product: z.string(), audience: z.string(),
    promise: z.string(), tone: z.string(), createdAt: z.string(),
  })),
  drafts: z.array(z.object({
    id: z.string(), brandId: z.string(), mainMessage: z.string(), detailedContent: z.string(),
    presentationDirection: z.string(), objective: z.string(), duration: z.string(),
    scriptPlan: z.string().optional(), scriptPlanHtml: z.string().optional(),
    revisionComment: z.string().optional(),
    title: z.string(), mainHook: z.string(), hooks: z.string(),
    painPointsOrIntroduction: z.string(), content: z.string(), conversion: z.string(),
    solution: z.string(), closing: z.string(), channels: z.array(channelSchema),
    status: z.enum(["draft", "approved"]), updatedAt: z.string(),
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
    status: z.literal("ready"), updatedAt: z.string(),
  })),
  socialAccounts: z.array(z.object({
    id: z.string(), brandId: z.string(), channel: channelSchema, platform: z.string(),
    platformLabel: z.string(), accountName: z.string(), accountUsername: z.string(),
    avatarUrl: z.string(), status: z.enum(["pending", "connected", "disconnected"]),
    linkedAt: z.string(),
  })).default([]),
  selectedBrandId: z.string(),
});

async function adLabOwner() {
  const user = await getCurrentUser();
  // 404 (not 401/403) for anyone outside the allowlist, so the endpoint does
  // not reveal that the private Ad Lab exists.
  if (!user || !isAdLabEnabledFor({ id: user.id, email: user.email })) {
    return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { ownerId: user.id };
}

export async function GET() {
  const auth = await adLabOwner();
  if (auth.error) return auth.error;
  try {
    const result = await adLabWorkspaceRepository.findByOwnerId(auth.ownerId!);
    return NextResponse.json(result);
  } catch (error) {
    if (isTransientPostgresConnectionError(error)) {
      console.warn("[GET /api/ad-lab/workspace] PostgreSQL is temporarily unreachable.");
    } else {
      console.error("[GET /api/ad-lab/workspace]", error);
    }
    return NextResponse.json(
      { error: "Ad Lab database is unavailable." },
      { status: 503, headers: { "Retry-After": "15" } }
    );
  }
}

export async function PUT(request: Request) {
  const auth = await adLabOwner();
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  const parsed = workspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Ad Lab workspace." }, { status: 400 });
  }
  try {
    const result = await adLabWorkspaceRepository.upsert(auth.ownerId!, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (isTransientPostgresConnectionError(error)) {
      console.warn("[PUT /api/ad-lab/workspace] PostgreSQL is temporarily unreachable.");
    } else {
      console.error("[PUT /api/ad-lab/workspace]", error);
    }
    return NextResponse.json(
      { error: "Ad Lab database is unavailable." },
      { status: 503, headers: { "Retry-After": "15" } }
    );
  }
}
