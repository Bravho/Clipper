/**
 * Per-video transfer state for the distribution-review screen.
 *
 * The distribution panel already knows each channel's export asset id; this only
 * tells it (a) whether Management is available to this user and (b) which of
 * those videos are ALREADY in Management (asset id → content item id), so each
 * per-video button can read "transfer" or "open in Management".
 *
 * Returns `enabled: false` (and an empty map) when the feature is off, so the
 * distribution screen is completely unchanged for users outside Management.
 */

import { managementContentRepository } from "@/repositories";
import { isManagementEnabledFor } from "@/config/management";

export interface DistributionTransferView {
  enabled: boolean;
  /** Export asset id → Management content item id, for videos already transferred. */
  transferredByAssetId: Record<string, string>;
}

export async function buildDistributionTransferView(
  user: { id: string; email?: string | null; role?: string | null },
  sourceRequestId: string
): Promise<DistributionTransferView> {
  if (!isManagementEnabledFor(user)) {
    return { enabled: false, transferredByAssetId: {} };
  }

  const items = await managementContentRepository.findAllBySource(
    user.id,
    sourceRequestId
  );
  const transferredByAssetId: Record<string, string> = {};
  for (const item of items) {
    if (item.sourceAssetId) transferredByAssetId[item.sourceAssetId] = item.id;
  }

  return { enabled: true, transferredByAssetId };
}
