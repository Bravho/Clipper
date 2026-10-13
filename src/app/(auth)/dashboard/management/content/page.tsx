import { getServerI18n } from "@/i18n/server";
import { videoAccessService } from "@/services/VideoAccessService";
import { VIDEO_LIFETIME_DAYS } from "@/config/retention";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { ROUTES } from "@/config/routes";
import { Card } from "@/components/ui/Card";
import {
  managementContentRepository,
  managementUploadBundleRepository,
  managementPublicationRepository,
} from "@/repositories";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { managementConnectionService } from "@/services/management/ManagementConnectionService";
import {
  MANAGEMENT_UPLOAD_MAX_BYTES,
  MANAGEMENT_UPLOAD_KEEP_LIMIT,
} from "@/services/management/ManagementUploadService";
import { spacesSignedUrl, spacesPublicUrl } from "@/lib/spaces";
import { estimatedSpaceExpiry } from "@/config/spacesLifecycle";
import { hasUsableMedia } from "@/domain/models/ManagementContent";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import { SOCIAL_PLATFORM_LABELS } from "@/services/social-publishing/types";
import {
  VideoLibrary,
  type LibraryVideo,
} from "@/features/management/components/VideoLibrary";

export const dynamic = "force-dynamic";

/**
 * "วิดิโอของคุณ" — the full video manager.
 *
 * Each video shows its thumbnail + player, the estimated DigitalOcean Space
 * expiry, the channels it has published to, an inline caption/hashtag editor,
 * and a soft-delete. Uploading your own video is gated on having a paid plan.
 */
export default async function ManagementContentPage() {
  const { t } = getServerI18n();
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();

  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  if (!isManagementEnabledFor(user)) notFound();

  const now = new Date();
  const [items, access, tokensRemaining, connections] = await Promise.all([
    managementContentRepository.findByUserId(user.id),
    managementEntitlementService.effectiveAccess(user.id, now),
    managementUploadBundleRepository.countSpendableTokens(user.id, now),
    managementConnectionService.list(user.id),
  ]);

  const connectedChannels = connections
    .filter(
      (connection) =>
        connection.connectionStatus === SocialConnectionStatus.Connected &&
        !!connection.providerAccountId
    )
    .map((connection) => ({
      id: connection.id,
      platform: connection.platform,
      label:
        SOCIAL_PLATFORM_LABELS[
          connection.platform as keyof typeof SOCIAL_PLATFORM_LABELS
        ] ?? connection.platform,
      accountName: connection.accountName ?? connection.accountUsername,
    }));

  const videos: LibraryVideo[] = await Promise.all(
    items.map(async (item): Promise<LibraryVideo> => {
      const [assets, publications, suggestions] = await Promise.all([
        managementContentRepository.findAssets(item.id),
        managementPublicationRepository.findByContentId(item.id),
        managementContentRepository.findChannelSuggestions(item.id),
      ]);
      const primary = assets[0] ?? null;
      const usable = hasUsableMedia(item);

      // Channels this video has gone out to, flattened from its publications.
      const owned = publications.filter((p) => p.userId === user.id);
      const targetLists = await Promise.all(
        owned.map((p) => managementPublicationRepository.findTargets(p.id))
      );
      const channels = targetLists.flat().map((t) => ({
        platform: t.platform,
        status: t.status,
        publishedUrl: t.publishedUrl,
      }));

      // The app's own expiry is the real date (it is enforced, and it is the
      // date the studio shows); the storage estimate only covers old items
      // that never had one.
      const spaceExpiry =
        item.mediaExpiresAt ??
        estimatedSpaceExpiry(primary?.storageKey ?? null, item.transferredAt ?? item.createdAt);

      return {
        id: item.id,
        title: item.title,
        description: item.description,
        defaultCaption: item.defaultCaption,
        defaultHashtags: item.defaultHashtags,
        sourceType: item.sourceType,
        thumbnailUrl: item.thumbnailStorageKey
          ? spacesPublicUrl(item.thumbnailStorageKey)
          : null,
        videoUrl: usable && primary ? await spacesSignedUrl(primary.storageKey) : null,
        assets: assets.map((asset) => ({
          id: asset.id,
          variant: asset.platformVariant,
          aspectRatio: asset.aspectRatio,
        })),
        suggestions: suggestions.map((suggestion) => ({
          platform: suggestion.platform,
          displayOrder: suggestion.displayOrder,
          title: suggestion.title,
          caption: suggestion.caption,
          hashtags: suggestion.hashtags,
          locale: suggestion.locale,
        })),
        channels,
        spaceExpiry: spaceExpiry ? spaceExpiry.toISOString() : null,
        usable,
      };
    })
  );

  // Uploading needs a live package (2026-10-12), up to
  // MANAGEMENT_UPLOAD_KEEP_LIMIT videos kept at once — the same rule
  // ManagementUploadService enforces; this only decides what the button says.
  const hasPackage = await videoAccessService.hasActivePackage(user.id).catch(() => false);
  const nowMs = Date.now();
  const uploadCount = items.filter(
    (i) =>
      i.sourceType === "user_upload" &&
      hasUsableMedia(i) &&
      (!i.mediaExpiresAt || i.mediaExpiresAt.getTime() > nowMs)
  ).length;
  const uploadsLeft = Math.max(0, MANAGEMENT_UPLOAD_KEEP_LIMIT - uploadCount);
  const canUpload = hasPackage && uploadsLeft > 0;
  const uploadBlockedReason = !hasPackage ? "package_required" : uploadsLeft > 0 ? null : "full";
  const uploadMaxMB = Math.round(MANAGEMENT_UPLOAD_MAX_BYTES / (1024 * 1024));

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("mgmt.yourVideos")}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {access
              ? t("mgmt.unlimitedActive")
              : tokensRemaining > 0
                ? t("mgmt.tokensLeft", { count: tokensRemaining })
                : t("mgmt.needPlan")}
          </p>
        </div>
        <Link
          href={ROUTES.MANAGEMENT_CONNECTIONS}
          className="shrink-0 text-sm font-medium text-blue-600 hover:underline"
        >
          {t("sidebar.channels")} →
        </Link>
      </header>

      <VideoLibrary
        videos={videos}
        connections={connectedChannels}
        unlimited={!!access}
        tokensRemaining={tokensRemaining}
        canUpload={canUpload}
        uploadMaxMB={uploadMaxMB}
        quotaNote={
          hasPackage
            ? t("mgmt.uploadPlaces", { left: uploadsLeft, total: MANAGEMENT_UPLOAD_KEEP_LIMIT, days: VIDEO_LIFETIME_DAYS })
            : t("mgmt.uploadIncluded", { days: VIDEO_LIFETIME_DAYS })
        }
        uploadBlockedReason={uploadBlockedReason}
      />

      {videos.length === 0 && (
        <Card className="mt-4">
          <p className="text-sm text-slate-500">
            {t("mgmt.tipTransfer")}
          </p>
        </Card>
      )}
    </div>
  );
}
