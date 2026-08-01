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
} from "@/repositories";
import { managementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { managementConnectionService } from "@/services/management/ManagementConnectionService";
import { hasUsableMedia } from "@/domain/models/ManagementContent";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import {
  SOCIAL_PLATFORM_LABELS,
} from "@/services/social-publishing/types";
import { PublishComposer } from "@/features/management/components/PublishComposer";

export const dynamic = "force-dynamic";

/**
 * The composer for one content item.
 *
 * Loads the video, its variants, the user's connected channels and their
 * account-wide entitlement, then hands off to the client composer. Ownership,
 * media availability and entitlement are all decided here on the server; the
 * client only renders and calls back the guarded APIs.
 */
export default async function ManagementComposerPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();

  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  if (!isManagementEnabledFor(user)) notFound();

  const item = await managementContentRepository.findById(params.id);
  // Missing and foreign look identical — no probing for other users' ids.
  if (!item || item.userId !== user.id) notFound();

  const now = new Date();
  const [assets, connections, suggestions, access, tokensRemaining] = await Promise.all([
    managementContentRepository.findAssets(item.id),
    managementConnectionService.list(user.id),
    managementContentRepository.findChannelSuggestions(item.id),
    managementEntitlementService.effectiveAccess(user.id, now),
    managementUploadBundleRepository.countSpendableTokens(user.id, now),
  ]);

  const usable = hasUsableMedia(item);

  const connected = connections
    .filter(
      (c) =>
        c.connectionStatus === SocialConnectionStatus.Connected && !!c.providerAccountId
    )
    .map((c) => ({
      id: c.id,
      platform: c.platform,
      label:
        SOCIAL_PLATFORM_LABELS[c.platform as keyof typeof SOCIAL_PLATFORM_LABELS] ??
        c.platform,
      accountName: c.accountName,
    }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <Link
          href={ROUTES.MANAGEMENT_CONTENT}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Library
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{item.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {assets.length} variant{assets.length === 1 ? "" : "s"} · publish to your channels
        </p>
      </header>

      {!usable ? (
        <Card>
          <p className="text-sm text-slate-700">
            This video&apos;s media is no longer available, so it cannot be published.
            Its record and history remain.
          </p>
        </Card>
      ) : (
        <PublishComposer
          contentId={item.id}
          title={item.title}
          defaultCaption={item.defaultCaption}
          defaultHashtags={item.defaultHashtags}
          assets={assets.map((a) => ({
            id: a.id,
            variant: a.platformVariant,
            aspectRatio: a.aspectRatio,
          }))}
          connections={connected}
          suggestions={suggestions.map((suggestion) => ({
            platform: suggestion.platform,
            displayOrder: suggestion.displayOrder,
            title: suggestion.title,
            caption: suggestion.caption,
            hashtags: suggestion.hashtags,
          }))}
          unlimited={!!access}
          tokensRemaining={tokensRemaining}
        />
      )}
    </div>
  );
}
