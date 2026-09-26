import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { isManagementEnabledFor } from "@/config/management";
import { ROUTES } from "@/config/routes";
import type { ClipRequest } from "@/domain/models/ClipRequest";
import { PLATFORM_ASPECT_RATIOS, PLATFORM_LABELS } from "@/domain/enums/Platform";
import { videoGenerationJobRepository } from "@/repositories";
import { clipRequestService } from "@/services/ClipRequestService";
import { eligibleExportAssetIds } from "@/services/management/ManagementEntitlementService";
import { buildDistributionTransferView } from "@/features/management/server/buildDistributionTransferView";
import {
  StudioTransferScreen,
  type TransferVideo,
} from "@/features/management/components/StudioTransferScreen";

export const dynamic = "force-dynamic";

/**
 * /dashboard/management/transfer?request=<id>
 *
 * The hand-over from the studio's Channels step to Channel Management, as a
 * page of its own: every finished video of the request is sent one by one
 * (`POST /api/management/transfers`, free and idempotent) with a row per video
 * that goes Waiting → Sending → In Channel Management, then the library opens
 * with the new videos highlighted.
 *
 * WHY A PAGE AND NOT A SPINNER IN THE STUDIO. It is a real navigation — Back
 * returns to the studio, a reload simply carries on (already-sent videos come
 * back as done), and it sits inside the dashboard layout, so the menu and the
 * way into Channel Management are the ones the person already knows.
 */
export default async function ManagementTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) notFound();
  const user = {
    id: session.user.id,
    email: session.user.email ?? null,
    role: session.user.role,
  };
  if (!isManagementEnabledFor(user)) notFound();

  const { request: requestId } = await searchParams;
  if (!requestId) redirect(ROUTES.MANAGEMENT);

  let request: ClipRequest;
  try {
    request = await clipRequestService.getOwnedRequest(requestId, user.id);
  } catch {
    notFound();
  }
  const job = await videoGenerationJobRepository.findByRequestId(request.id);
  // Only FINISHED (captioned) videos. While a skipped shape is being made,
  // its master exists before its captions do, and that master is a step on
  // the way, not a video to publish.
  const finished = new Set(
    job
      ? [
          job.captionedExport_9_16_assetId,
          job.captionedExport_16_9_assetId,
          job.captionedExport_4_5_assetId,
        ].filter((id): id is string => Boolean(id))
      : []
  );
  const exports = job
    ? eligibleExportAssetIds(job).filter((entry) => finished.has(entry.assetId))
    : [];
  const view = await buildDistributionTransferView(user, request.id);

  const platforms = request.targetPlatforms ?? [];
  const channelsFor = (ratio: string | null) =>
    platforms
      .filter((platform) => PLATFORM_ASPECT_RATIOS[platform] === ratio)
      .map((platform) => PLATFORM_LABELS[platform])
      .join(", ");

  const videos: TransferVideo[] = exports.map((entry) => ({
    assetId: entry.assetId,
    ratio: entry.ratio ?? entry.variant,
    channels: channelsFor(entry.ratio),
    contentId: view.transferredByAssetId[entry.assetId] ?? null,
  }));

  return (
    <StudioTransferScreen
      requestId={request.id}
      title={request.title || request.placeName || ""}
      videos={videos}
    />
  );
}
