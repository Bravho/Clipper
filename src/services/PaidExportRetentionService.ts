/**
 * PaidExportRetentionService — promote a requester's PAID final clips out of the
 * short `final_exports/` window into the longer `paid_exports/` one.
 *
 * WHY THIS EXISTS. `final_exports/` is the clean deliverable, kept only for the
 * short download window (bucket rule ~15 days) so unpaid/abandoned clips do not
 * accumulate. When a requester pays to distribute/download the video
 * (`ClipRequestService.unlockDownload`), the master should survive longer, so we
 * relocate it into `paid_exports/` — a 30-day (bucket rule 31), clock-resettable
 * prefix, the same pattern the RClipper Management retention flows use.
 *
 * HOW EXPIRY IS ENFORCED. Purely by DigitalOcean Spaces lifecycle rules, which
 * count from an object's CREATION time. The only way to extend is to MOVE the
 * object (server-side copy to a fresh key, then delete the source) so the copy's
 * clock restarts. `paid_exports/` is deliberately absent from
 * src/config/mediaPrefixes.json, so neither the clip purge nor the orphan sweep
 * ever deletes a paid master.
 *
 * IDEMPOTENT AND SAFE. Only assets still under `final_exports/` are moved, so a
 * re-run (or a double unlock) finds nothing left and no-ops. Per-object failures
 * are logged and skipped — a storage hiccup must never fail an unlock the user
 * already paid for; the worst case is a master that expires on its original short
 * window instead of the extended one.
 */

import { uploadedAssetRepository } from "@/repositories";
import { spacesMoveObject, spacesPublicUrl } from "@/lib/spaces";
import { buildPaidExportKey } from "@/lib/spacesKeys";
import { AssetType } from "@/domain/enums/AssetType";

const FINAL_PREFIX = "final_exports/";

export class PaidExportRetentionService {
  constructor(
    private assets = uploadedAssetRepository,
    private moveObject = spacesMoveObject
  ) {}

  /**
   * Move every clean FinalClip master for one request into `paid_exports/`.
   * Returns how many files were relocated. Safe to call on every unlock.
   */
  async promoteForRequest(userId: string, requestId: string): Promise<number> {
    const rows = await this.assets.findByRequestId(requestId);
    const finals = rows.filter(
      (a) =>
        a.assetType === AssetType.FinalClip &&
        a.storageKey.startsWith(FINAL_PREFIX)
    );

    let moved = 0;
    for (const asset of finals) {
      const fileName = asset.storageKey.slice(
        asset.storageKey.lastIndexOf("/") + 1
      );
      const newKey = buildPaidExportKey(userId, requestId, fileName);

      try {
        await this.moveObject(asset.storageKey, newKey);
      } catch (err) {
        console.error(
          `[paid export retention] move failed for asset ${asset.id}:`,
          err instanceof Error ? err.message : err
        );
        continue;
      }

      await this.assets.update(asset.id, {
        storageKey: newKey,
        storageUrl: spacesPublicUrl(newKey),
      });
      moved += 1;
    }

    return moved;
  }
}

export const paidExportRetentionService = new PaidExportRetentionService();
