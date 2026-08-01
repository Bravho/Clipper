/**
 * ManagementTransferRetentionService — promote a paying user's TRANSFERRED
 * generation videos into the paid `management_retained/` window.
 *
 * WHY THIS EXISTS. A free transfer does NOT copy media: the Management item just
 * references the generation's `final_exports/` clip, which lives only for its
 * short download window (~8 days). Paying for RClipper Management should keep the
 * video alive for the paid retention window, so on payment we relocate the clip
 * into `management_retained/` — the same 30-day, clock-resettable prefix the
 * self-upload flow uses (see {@link ManagementUploadRetentionService}).
 *
 * COPY vs MOVE. A clip still under the generation prefix is COPIED (the
 * generation keeps its own `final_exports/` copy for its own window); a clip
 * already under `management_retained/` is MOVED to a fresh key, which resets the
 * bucket lifecycle clock (expiry counts from creation, so a re-key is the only
 * way to extend). Either way the Management asset row is repointed and
 * `media_expires_at` is pushed to now + the paid window.
 *
 * The POSTER is left in the public, long-lived `thumbnails/` prefix — it already
 * outlives every video, so there is nothing to promote.
 *
 * IDEMPOTENT AND SAFE. Per-object failures are swallowed and skipped; the
 * enqueuing purchase is de-duplicated upstream, so a job retry re-runs at most
 * once per purchase.
 */

import { managementContentRepository } from "@/repositories";
import { spacesCopyObject, spacesMoveObject } from "@/lib/spaces";
import { buildManagementRetainedKey } from "@/lib/spacesKeys";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { MANAGEMENT_UPLOAD_RETAINED_DAYS } from "@/services/management/ManagementUploadRetentionService";
import { ManagementSourceType } from "@/domain/enums/ManagementStatus";

const RETAINED_PREFIX = "management_retained/";

export class ManagementTransferRetentionService {
  constructor(
    private content = managementContentRepository,
    private copyObject = spacesCopyObject,
    private moveObject = spacesMoveObject,
    private audit = managementAuditService
  ) {}

  /**
   * Promote every transferred item for one user into the paid window. Returns
   * how many video files were relocated. Safe to call on every purchase.
   */
  async extendForUser(userId: string, now: Date = new Date()): Promise<number> {
    const items = await this.content.findByUserId(userId);
    const transfers = items.filter(
      (i) => i.sourceType === ManagementSourceType.RClipperGeneration
    );

    let movedFiles = 0;
    const newExpiry = new Date(
      now.getTime() + MANAGEMENT_UPLOAD_RETAINED_DAYS * 86_400_000
    );

    for (const item of transfers) {
      const assets = await this.content.findAssets(item.id);
      let relocatedForItem = false;

      for (const asset of assets) {
        const fileName = asset.storageKey.slice(
          asset.storageKey.lastIndexOf("/") + 1
        );
        const newKey = buildManagementRetainedKey(userId, item.id, fileName);
        try {
          if (asset.storageKey.startsWith(RETAINED_PREFIX)) {
            // Already paid-retained: re-key to reset the 30-day clock.
            await this.moveObject(asset.storageKey, newKey);
          } else {
            // Still referencing the generation export: copy it in, leaving the
            // generation's own copy to expire on its own short window.
            await this.copyObject(asset.storageKey, newKey);
          }
        } catch (err) {
          // A source already purged (the free window lapsed before payment) or a
          // transient Spaces error: skip this file, keep the DB pointing at the
          // old key, and let the rest proceed.
          console.error(
            `[management transfer retention] relocate failed for asset ${asset.id}:`,
            err instanceof Error ? err.message : err
          );
          continue;
        }
        await this.content.updateAssetStorageKey(asset.id, newKey);
        movedFiles += 1;
        relocatedForItem = true;
      }

      if (relocatedForItem) {
        await this.content.update(item.id, { mediaExpiresAt: newExpiry });
      }
    }

    if (movedFiles > 0) {
      await this.audit.record("management.transfer.retention_extended", {
        userId,
        metadata: {
          movedFiles,
          retentionDays: MANAGEMENT_UPLOAD_RETAINED_DAYS,
          newExpiresAt: newExpiry.toISOString(),
        },
      });
    }

    return movedFiles;
  }
}

export const managementTransferRetentionService =
  new ManagementTransferRetentionService();
