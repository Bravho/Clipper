/**
 * ManagementUploadRetentionService — extend a paying user's uploaded videos from
 * the free 7-day storage window to the paid 30-day one.
 *
 * HOW EXPIRY IS ENFORCED. Management self-uploads are governed by DigitalOcean
 * Spaces LIFECYCLE RULES, not the app sweep. A file in `management_uploads/` is
 * auto-deleted after ~7 days; a file in `management_retained/` after ~30. Because
 * lifecycle expiry counts from an object's CREATION time, the only way to extend
 * is to MOVE the object (server-side copy to a fresh key, then delete the source)
 * — the copy is brand new, so its clock restarts.
 *
 * WHAT THIS PROMOTES. Every management purchase triggers this for the buyer. It
 * moves only uploaded videos still sitting in the FREE prefix — a video already
 * in `management_retained/` is left alone (so repeated purchases do not keep
 * re-copying and resetting a window that is already generous). Transferred
 * generator videos are never touched; they keep their own export windows.
 *
 * IDEMPOTENT. Re-running finds nothing left in the free prefix and no-ops, so a
 * job retry or a double delivery is safe.
 */

import { managementContentRepository } from "@/repositories";
import { spacesMoveObject } from "@/lib/spaces";
import { buildManagementRetainedKey } from "@/lib/spacesKeys";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import { ManagementSourceType } from "@/domain/enums/ManagementStatus";

/** Paid retention window, in days. The bucket rule should be this + a safety day. */
export const MANAGEMENT_UPLOAD_RETAINED_DAYS = Number(
  process.env.RCLIPPER_MANAGEMENT_UPLOAD_RETAINED_DAYS ?? "30"
);

const FREE_PREFIX = "management_uploads/";

export class ManagementUploadRetentionService {
  constructor(
    private content = managementContentRepository,
    private moveObject = spacesMoveObject,
    private audit = managementAuditService
  ) {}

  /**
   * Promote every eligible upload for one user. Returns how many FILES were
   * moved. Safe to call on every purchase.
   */
  async extendForUser(userId: string, now: Date = new Date()): Promise<number> {
    const items = await this.content.findByUserId(userId);
    const uploads = items.filter(
      (i) => i.sourceType === ManagementSourceType.UserUpload
    );

    let movedFiles = 0;
    const newExpiry = new Date(now.getTime() + MANAGEMENT_UPLOAD_RETAINED_DAYS * 86_400_000);

    for (const item of uploads) {
      const assets = await this.content.findAssets(item.id);
      let movedForItem = false;

      for (const asset of assets) {
        // Only promote what is still in the free prefix.
        if (!asset.storageKey.startsWith(FREE_PREFIX)) continue;

        const fileName = asset.storageKey.slice(asset.storageKey.lastIndexOf("/") + 1);
        const newKey = buildManagementRetainedKey(userId, item.id, fileName);

        try {
          await this.moveObject(asset.storageKey, newKey);
        } catch (err) {
          // A file already purged (past its 7 days before payment) or a transient
          // Spaces error: leave the DB pointing at the old key, skip, and let the
          // job retry the rest. Never abort the whole promotion for one file.
          console.error(
            `[management retention] move failed for asset ${asset.id}:`,
            err instanceof Error ? err.message : err
          );
          continue;
        }

        await this.content.updateAssetStorageKey(asset.id, newKey);
        movedFiles += 1;
        movedForItem = true;
      }

      if (movedForItem) {
        await this.content.update(item.id, { mediaExpiresAt: newExpiry });
      }
    }

    if (movedFiles > 0) {
      await this.audit.record("management.upload.retention_extended", {
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

export const managementUploadRetentionService = new ManagementUploadRetentionService();
