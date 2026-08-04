import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { getServerI18n } from "@/i18n/server";
import { Card } from "@/components/ui/Card";
import {
  managementAccessPassRepository,
  managementContentRepository,
  managementPurchaseRepository,
  managementUploadBundleRepository,
  managementPublicationRepository,
} from "@/repositories";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { managementConnectionService } from "@/services/management/ManagementConnectionService";
import {
  MANAGEMENT_UPLOAD_MAX_BYTES,
  MANAGEMENT_FREE_UPLOAD_LIMIT,
  MANAGEMENT_UPLOAD_RETENTION_DAYS,
} from "@/services/management/ManagementUploadService";
import { spacesSignedUrl, spacesPublicUrl } from "@/lib/spaces";
import { estimatedSpaceExpiry } from "@/config/spacesLifecycle";
import {
  ManagementAccessPassStatus,
  ManagementContentStatus,
  ManagementUploadBundleStatus,
  SocialConnectionStatus,
} from "@/domain/enums/ManagementStatus";
import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";
import type { ManagementAccessPass } from "@/domain/models/ManagementEntitlement";
import type { ManagementUploadBundle } from "@/domain/models/ManagementUploadBundle";
import { hasUsableMedia } from "@/domain/models/ManagementContent";
import { SOCIAL_PLATFORM_LABELS } from "@/services/social-publishing/types";
import {
  VideoLibrary,
  type LibraryVideo,
} from "@/features/management/components/VideoLibrary";
import {
  ManagementPackageStatus,
  type ManagementPackageSummary,
  type PackageDisplayStatus,
} from "@/features/management/components/ManagementPackageStatus";

export const dynamic = "force-dynamic";

/**
 * RClipper Management — the hub.
 *
 * Everything a Management user manages lives here: the counts, and the full
 * video library ("วิดิโอของคุณ") with player, storage expiry, channels, an
 * inline caption/hashtag editor, delete, and the free self-upload. Payment
 * history is deliberately NOT shown here — it belongs in the Credits tab's
 * Transaction History, which already records Management purchases.
 */
export default async function ManagementOverviewPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();

  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  if (!isManagementEnabledFor(user)) notFound();

  const { t } = getServerI18n();
  const now = new Date();

  const [
    items,
    access,
    tokensRemaining,
    removedCount,
    connections,
    uploadBundles,
    accessPasses,
    purchases,
  ] = await Promise.all([
    managementContentRepository.findByUserId(user.id),
    managementEntitlementService.effectiveAccess(user.id, now),
    managementUploadBundleRepository.countSpendableTokens(user.id, now),
    managementContentRepository.countRemoved(user.id),
    managementConnectionService.list(user.id),
    managementUploadBundleRepository.findByUserId(user.id),
    managementAccessPassRepository.findByUserId(user.id),
    managementPurchaseRepository.findByUserId(user.id),
  ]);

  const purchasesById = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  const packageSummaries: ManagementPackageSummary[] = [
    ...uploadBundles.map((bundle) => {
      const purchase = purchasesById.get(bundle.purchaseId);
      return {
        id: bundle.id,
        name: PACKAGE_NAMES[bundle.productCode],
        kind: "upload_bundle" as const,
        status: uploadBundleDisplayStatus(bundle, now),
        creditsUsed: purchase?.amountCredits ?? null,
        remainingUploads: bundle.remaining,
        totalUploads: bundle.totalAllowance,
        boughtAt: purchase?.paidAt ?? purchase?.createdAt ?? bundle.createdAt,
        startsAt: bundle.startsAt,
        expiresAt: bundle.expiresAt,
      };
    }),
    ...accessPasses.map((pass) => {
      const purchase = purchasesById.get(pass.purchaseId);
      return {
        id: pass.id,
        name: PACKAGE_NAMES[pass.productCode],
        kind: "access_pass" as const,
        status: accessPassDisplayStatus(pass, now),
        creditsUsed: purchase?.amountCredits ?? null,
        remainingUploads: null,
        totalUploads: null,
        boughtAt: purchase?.paidAt ?? purchase?.createdAt ?? pass.createdAt,
        startsAt: pass.startsAt,
        expiresAt: pass.expiresAt,
      };
    }),
  ].sort((left, right) => right.boughtAt.getTime() - left.boughtAt.getTime());
  const currentPackages = packageSummaries.filter(
    (item) => item.status === "active" || item.status === "scheduled"
  );
  const displayedPackages =
    currentPackages.length > 0 ? currentPackages : packageSummaries.slice(0, 1);

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

  // Only a `connected` row with a provider account id can actually be published
  // to. Attempts that never completed are counted separately so the publish
  // modal can say "you have 2 incomplete connections" instead of the flatly
  // wrong "no connected channels yet".
  const incompleteConnections = connections.filter(
    (connection) => connection.connectionStatus === SocialConnectionStatus.Pending
  ).length;

  const counts = {
    ready: items.filter((c) => c.status === ManagementContentStatus.Ready).length,
    published: items.filter((c) => c.status === ManagementContentStatus.Published).length,
    removed: removedCount,
  };

  const videos: LibraryVideo[] = await Promise.all(
    items.map(async (item): Promise<LibraryVideo> => {
      const [assets, publications, suggestions] = await Promise.all([
        managementContentRepository.findAssets(item.id),
        managementPublicationRepository.findByContentId(item.id),
        managementContentRepository.findChannelSuggestions(item.id),
      ]);
      const primary = assets[0] ?? null;
      const usable = hasUsableMedia(item);

      const owned = publications.filter((p) => p.userId === user.id);
      const targetLists = await Promise.all(
        owned.map((p) => managementPublicationRepository.findTargets(p.id))
      );
      const channels = targetLists.flat().map((tg) => ({
        platform: tg.platform,
        status: tg.status,
        publishedUrl: tg.publishedUrl,
      }));

      const spaceExpiry =
        estimatedSpaceExpiry(
          primary?.storageKey ?? null,
          item.transferredAt ?? item.createdAt
        ) ?? item.mediaExpiresAt;

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

  const uploadCount = items.filter((i) => i.sourceType === "user_upload").length;
  const uploadsLeft = Math.max(0, MANAGEMENT_FREE_UPLOAD_LIMIT - uploadCount);
  const canUpload = uploadsLeft > 0;
  const uploadMaxMB = Math.round(MANAGEMENT_UPLOAD_MAX_BYTES / (1024 * 1024));

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">
          {t("management.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("management.subtitle")}</p>
      </header>

      <ManagementPackageStatus packages={displayedPackages} />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Ready" value={counts.ready} />
        <Stat label="Published" value={counts.published} />
        <Stat label="Removed" value={counts.removed} />
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">วิดิโอของคุณ</h2>
          {access ? (
            <span className="text-xs text-slate-500">
              Unlimited publishing until{" "}
              {access.expiresAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </span>
          ) : (
            <span className="text-xs text-slate-500">
              {tokensRemaining} publish token{tokensRemaining === 1 ? "" : "s"} left
            </span>
          )}
        </div>

        <VideoLibrary
          videos={videos}
          connections={connectedChannels}
          incompleteConnections={incompleteConnections}
          unlimited={!!access}
          tokensRemaining={tokensRemaining}
          canUpload={canUpload}
          uploadMaxMB={uploadMaxMB}
          quotaNote={`free · ${uploadsLeft} of ${MANAGEMENT_FREE_UPLOAD_LIMIT} upload slots left · kept ${MANAGEMENT_UPLOAD_RETENTION_DAYS} days`}
        />
      </section>
    </div>
  );
}

const PACKAGE_NAMES: Record<ManagementProductCode, string> = {
  management_single_video: "Starter Credit Pack (4 uploads)",
  management_access_3_months: "3-Month Publishing Access",
  management_access_6_months: "6-Month Publishing Access",
  management_access_1_year: "1-Year Publishing Access",
};

function uploadBundleDisplayStatus(
  bundle: ManagementUploadBundle,
  now: Date
): PackageDisplayStatus {
  if (bundle.status === ManagementUploadBundleStatus.Refunded) return "refunded";
  if (bundle.status === ManagementUploadBundleStatus.Revoked) return "revoked";
  if (
    bundle.status === ManagementUploadBundleStatus.Expired ||
    bundle.expiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }
  if (bundle.remaining <= 0) return "exhausted";
  return "active";
}

function accessPassDisplayStatus(
  pass: ManagementAccessPass,
  now: Date
): PackageDisplayStatus {
  if (pass.status === ManagementAccessPassStatus.Refunded) return "refunded";
  if (pass.status === ManagementAccessPassStatus.Revoked) return "revoked";
  if (
    pass.status === ManagementAccessPassStatus.Expired ||
    pass.expiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }
  if (pass.startsAt.getTime() > now.getTime()) return "scheduled";
  return "active";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card padding="none" className="p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </Card>
  );
}
