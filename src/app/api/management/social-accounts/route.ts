import { NextResponse } from "next/server";
import { z } from "zod";
import {
  managementConnectionService,
  ManagementConnectionError,
} from "@/services/management/ManagementConnectionService";
import {
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  isSocialPlatform,
} from "@/services/social-publishing/types";
import { managementConnectablePlatforms } from "@/config/management";
import { requireManagementUser, managementErrorResponse } from "../_guard";
import { appUrl } from "@/lib/appOrigin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  platform: z.string().min(1).max(50),
});

/** Where the provider should send the user back to. */
const CALLBACK_PATH = "/api/management/social-accounts/callback";

/**
 * GET /api/management/social-accounts
 *
 * The user's connected accounts, plus the platforms available to connect.
 *
 * Returns only display metadata. No tokens exist to return — they are dropped
 * at the provider boundary and never stored.
 */
export async function GET() {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  try {
    const connections = await managementConnectionService.list(guard.user.id);

    return NextResponse.json({
      connections: connections.map((c) => ({
        id: c.id,
        platform: c.platform,
        platformLabel:
          SOCIAL_PLATFORM_LABELS[c.platform as keyof typeof SOCIAL_PLATFORM_LABELS] ??
          c.platform,
        accountName: c.accountName,
        accountUsername: c.accountUsername,
        avatarUrl: c.avatarUrl,
        status: c.connectionStatus,
        connectedAt: c.connectedAt?.toISOString() ?? null,
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
      })),
      // Only surface the platforms currently enabled for connecting; the rest
      // are hidden from the "add account" grid until they are turned on.
      availablePlatforms: SOCIAL_PLATFORMS.filter((p) =>
        managementConnectablePlatforms().includes(p)
      ).map((p) => ({
        platform: p,
        label: SOCIAL_PLATFORM_LABELS[p],
      })),
    });
  } catch (err) {
    return managementErrorResponse("GET /api/management/social-accounts", err);
  }
}

/**
 * POST /api/management/social-accounts
 *
 * Starts a connection and returns the URL to send the user to.
 *
 * CONNECTING IS FREE — no entitlement check here. Users must be able to set up
 * their accounts before deciding to pay, and gating this would mean asking for
 * money before showing that the thing works.
 *
 * A fresh URL is generated per attempt; these must not be cached or reused.
 */
export async function POST(request: Request) {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isSocialPlatform(parsed.data.platform)) {
    return NextResponse.json({ error: "Unsupported platform." }, { status: 400 });
  }

  try {
    const result = await managementConnectionService.start({
      user: guard.user,
      platform: parsed.data.platform,
      // Previously omitted, which made `start()`'s redirectUrl parameter dead
      // code and left even White Label projects depending entirely on the
      // provider dashboard's configured redirect.
      redirectUrl: appUrl(request, CALLBACK_PATH).toString(),
    });
    return NextResponse.json({
      authorizationUrl: result.authorizationUrl,
      connectionId: result.connectionId,
    });
  } catch (err) {
    if (err instanceof ManagementConnectionError) {
      return NextResponse.json(
        { error: err.message, reason: err.code },
        { status: err.code === "feature_disabled" ? 404 : 400 }
      );
    }
    return managementErrorResponse("POST /api/management/social-accounts", err);
  }
}
