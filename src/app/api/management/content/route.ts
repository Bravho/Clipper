import { NextResponse } from "next/server";
import {
  managementContentRepository,
  managementUploadBundleRepository,
} from "@/repositories";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { requireManagementUser, managementErrorResponse } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/management/content
 *
 * The user's library — both transferred generation projects and their own
 * uploads, which are indistinguishable here apart from `sourceType`.
 *
 * Readable even when access has EXPIRED and even when a video's media has been
 * purged: expiry blocks new publishing, it does not hide what the user
 * collected. `mediaExpiresAt` tells the UI how long each file is kept.
 *
 * Publishing entitlement is account-wide now, not per item: an active pass gives
 * `unlimitedPublishing`, otherwise the user spends `uploadTokensRemaining` — one
 * token per video-to-one-channel. The composer uses these to decide whether to
 * show the pay-to-publish gate.
 */
export async function GET() {
  const guard = await requireManagementUser();
  if (!guard.ok) return guard.response;

  try {
    const now = new Date();
    const [items, access, uploadTokensRemaining] = await Promise.all([
      managementContentRepository.findByUserId(guard.user.id),
      managementEntitlementService.effectiveAccess(guard.user.id, now),
      managementUploadBundleRepository.countSpendableTokens(guard.user.id, now),
    ]);

    const withAssets = await Promise.all(
      items.map(async (item) => {
        const [assets, suggestions] = await Promise.all([
          managementContentRepository.findAssets(item.id),
          managementContentRepository.findChannelSuggestions(item.id),
        ]);
        return {
          id: item.id,
          sourceType: item.sourceType,
          sourceGenerationId: item.sourceGenerationId,
          title: item.title,
          status: item.status,
          transferredAt: item.transferredAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
          thumbnailStorageKey: item.thumbnailStorageKey,
          // The stored file is time-limited; entitlement is account-wide.
          mediaExpiresAt: item.mediaExpiresAt?.toISOString() ?? null,
          mediaDeletedAt: item.mediaDeletedAt?.toISOString() ?? null,
          variants: assets.map((a) => ({
            id: a.id,
            platformVariant: a.platformVariant,
            aspectRatio: a.aspectRatio,
            durationSeconds: a.durationSeconds,
          })),
          suggestedChannels: suggestions.map((suggestion) => ({
            platform: suggestion.platform,
            displayOrder: suggestion.displayOrder,
            title: suggestion.title,
            caption: suggestion.caption,
            hashtags: suggestion.hashtags,
            locale: suggestion.locale,
          })),
        };
      })
    );

    return NextResponse.json({
      content: withAssets,
      // An active pass permits unlimited publishing. Otherwise the user publishes
      // by spending upload tokens (one per video-to-one-channel).
      unlimitedPublishing: !!access,
      uploadTokensRemaining,
      access: access
        ? { expiresAt: access.expiresAt.toISOString(), autoRenew: false }
        : null,
    });
  } catch (err) {
    return managementErrorResponse("GET /api/management/content", err);
  }
}
