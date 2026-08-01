import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";

/**
 * An accounting record of one RClipper Management purchase.
 *
 * PostgreSQL → `management_purchases`.
 *
 * Payment is a CREDIT DEBIT: the credits were already bought through a verified
 * rail (the signed Stripe webhook on web, Apple/Google receipt verification in
 * the native apps) before they reached the wallet, so this row records the
 * spend rather than a gateway charge. `creditTransactionId` points at the
 * immutable `credit_transactions` ledger entry, which is the financial source
 * of truth.
 *
 * WHEN THIS HAPPENS: at publish time. Transferring and uploading are free, so a
 * purchase always names either the content item being unlocked
 * (`management_single_video`) or nothing at all (an access pass, which is not
 * tied to any one video).
 *
 * IDEMPOTENCY: `idempotencyKey` carries a UNIQUE constraint. For a single-video
 * unlock it is derived from (userId, productCode, managementContentId), so a
 * double-clicked or replayed checkout can never debit twice. Access passes are
 * legitimately repeatable, so their key includes a caller-supplied request
 * token that is stable for the lifetime of one checkout.
 */
export interface ManagementPurchase {
  id: string;
  userId: string;
  managementProductId: string;
  productCode: ManagementProductCode;
  /** The item being unlocked; null for an access pass. */
  managementContentId: string | null;
  status: ManagementPurchaseStatus;
  /** Credits debited. 1 credit = ฿1. */
  amountCredits: number;
  currency: string;
  idempotencyKey: string;
  /** credit_transactions.id for the debit. */
  creditTransactionId: string | null;
  paidAt: Date | null;
  failureReason: string | null;
  /** Set when credits are returned; the entitlement is revoked at the same time. */
  refundedAt: Date | null;
  refundCreditTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Purchase lifecycle.
 *
 * Note there is no "fulfilment failed" state any more. Payment now buys an
 * entitlement outright rather than triggering a transfer, and the entitlement is
 * created in the same transaction as the debit — so a purchase either fully
 * succeeded or never charged.
 */
export enum ManagementPurchaseStatus {
  /** Debit attempted but not yet committed. Only ever transient. */
  Pending = "pending",
  /** Credits debited and the entitlement activated. */
  Paid = "paid",
  /** The debit failed (e.g. insufficient credits). No entitlement exists. */
  Failed = "failed",
  Refunded = "refunded",
}

export interface CreateManagementPurchaseInput {
  userId: string;
  managementProductId: string;
  productCode: ManagementProductCode;
  managementContentId: string | null;
  amountCredits: number;
  idempotencyKey: string;
}
