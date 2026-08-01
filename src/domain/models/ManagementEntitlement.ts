import {
  ManagementAccessPassStatus,
  ManagementEntitlementType,
  ManagementPublishEntitlementStatus,
} from "@/domain/enums/ManagementStatus";
import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";

/**
 * A purchased prepaid access pass — unlimited publishing while active.
 *
 * PostgreSQL → `management_access_passes`.
 *
 * ONE ROW PER PURCHASE. A pass is never mutated to extend it: buying another
 * inserts a NEW row whose window begins at the later of "now" and the current
 * effective expiry, so remaining paid time is always preserved and the purchase
 * history stays auditable. The user's *effective* access is the maximum
 * `expiresAt` across active, non-revoked rows.
 *
 * Nothing renews. When `expiresAt` passes, no charge occurs, no content is
 * deleted, and no already-published social post is touched — only NEW
 * publications stop being permitted.
 */
export interface ManagementAccessPass {
  id: string;
  userId: string;
  managementProductId: string;
  productCode: ManagementProductCode;
  /** The credit-ledger transaction that paid for this pass. */
  creditTransactionId: string | null;
  /** The management_purchases row that produced this pass. */
  purchaseId: string;
  status: ManagementAccessPassStatus;
  /** UTC. May be in the future when this pass extends an existing one. */
  startsAt: Date;
  /** UTC. startsAt + durationMonths calendar months. */
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A permanent publish unlock for ONE content item.
 *
 * PostgreSQL → `management_publish_entitlements`.
 *
 * Bought with `management_single_video`. It is NOT consumed by use: publishing
 * again, adding a channel weeks later, or retrying a failed send all cost
 * nothing further. There is deliberately no `consumedAt` field.
 *
 * It also outlives the stored media. When a video passes its retention window
 * and is purged, this row survives, so the user may upload a replacement into
 * the same content item without paying again.
 */
export interface ManagementPublishEntitlement {
  id: string;
  userId: string;
  managementContentId: string;
  managementProductId: string;
  creditTransactionId: string | null;
  purchaseId: string;
  status: ManagementPublishEntitlementStatus;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The result of evaluating whether a user may PUBLISH a given content item now.
 *
 * Always computed fresh from the passes and unlocks above — never cached as a
 * boolean, so a revocation, refund or expiry takes effect on the next request.
 *
 * The frontend receives this only for rendering; every mutating route
 * recomputes it server-side.
 */
export interface ManagementEntitlement {
  allowed: boolean;
  entitlementType: ManagementEntitlementType;
  accessPassId?: string;
  publishEntitlementId?: string;
  purchaseId?: string;
  /** Effective access window, when an access pass is what grants permission. */
  startsAt?: Date;
  expiresAt?: Date;
  /**
   * Spendable upload tokens across the user's live bundles, when token balance
   * is what grants (or would grant) permission. Undefined for a pass, which is
   * unlimited and counts no tokens.
   */
  tokensRemaining?: number;
  /**
   * Machine-readable explanation when `allowed` is false. The UI maps this to a
   * localised message; it is never shown raw.
   */
  reason?: ManagementDenialReason;
}

export type ManagementDenialReason =
  | "feature_disabled"
  | "not_authenticated"
  | "not_owner"
  | "content_not_found"
  | "media_expired"
  | "no_eligible_media"
  | "payment_required"
  | "access_expired"
  | "entitlement_revoked"
  | "entitlement_refunded";

/**
 * Whether a completed generation project may be TRANSFERRED into Management.
 *
 * Transfer is FREE and optional, so this carries no payment outcome — only
 * ownership and readiness. Payment is evaluated separately, at publish time.
 */
export interface ManagementTransferEligibility {
  allowed: boolean;
  /** True when the project has already been transferred. */
  alreadyTransferred: boolean;
  /** The existing content item, when already transferred. */
  managementContentId?: string;
  /** How many generated videos would move across. */
  videoCount: number;
  reason?:
    | "feature_disabled"
    | "not_owner"
    | "generation_incomplete"
    | "no_eligible_media";
}
