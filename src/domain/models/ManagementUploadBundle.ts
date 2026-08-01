import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";
import { ManagementUploadBundleStatus } from "@/domain/enums/ManagementStatus";

/**
 * A purchased allowance of upload tokens — the RClipper Management ENTRY product.
 *
 * PostgreSQL → `management_upload_bundles` (migration 020).
 *
 * WHAT ONE TOKEN BUYS. One token publishes one video to ONE channel — i.e. one
 * publication target. The same file sent to three channels spends three tokens;
 * different aspect ratios of the same content are different videos. Access passes
 * are a different thing entirely (unlimited publishing for a window) and never
 * touch a bundle.
 *
 * CONSUMABLE AND EXPIRING. `remaining` starts at `totalAllowance` and is
 * decremented atomically as tokens are spent (a guarded `UPDATE ... WHERE
 * remaining >= n`, backed by storage-level CHECKs, so a racing double-publish
 * can never drive it below zero). Unspent tokens are forfeit once `expiresAt`
 * passes — the 30-day window is only the window to SPEND the allowance, not how
 * long a post stays up nor the 90-day media-storage window.
 *
 * ONE ROW PER PURCHASE. `purchaseId` is unique, so a replayed activation returns
 * the existing bundle rather than granting a second allowance for one payment.
 */
export interface ManagementUploadBundle {
  id: string;
  userId: string;
  managementProductId: string;
  productCode: ManagementProductCode;
  /** The management_purchases row that produced this bundle. */
  purchaseId: string;
  /** credit_transactions.id for the debit. */
  creditTransactionId: string | null;
  /** How many tokens the purchase bought. Immutable. */
  totalAllowance: number;
  /** Tokens still spendable. Decremented as publications are created. */
  remaining: number;
  startsAt: Date;
  /** UTC. startsAt + accessWindowDays. After this, unspent tokens are forfeit. */
  expiresAt: Date;
  status: ManagementUploadBundleStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** True when a bundle can still have tokens spent from it right now. */
export function isBundleSpendable(
  bundle: Pick<ManagementUploadBundle, "status" | "remaining" | "expiresAt">,
  now: Date = new Date()
): boolean {
  return (
    bundle.status === ManagementUploadBundleStatus.Active &&
    bundle.remaining > 0 &&
    bundle.expiresAt.getTime() > now.getTime()
  );
}
