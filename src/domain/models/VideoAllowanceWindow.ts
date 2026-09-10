import type { VideoProductCode } from "@/domain/enums/VideoProductCode";
import { VideoAllowanceWindowStatus } from "@/domain/enums/VideoAllowanceStatus";

/**
 * One purchased MONTH of video-request allowance.
 *
 * PostgreSQL → `video_allowance_windows` (migration 033). Modelled directly on
 * {@link ManagementUploadBundle}, which is already a consumable, expiring,
 * atomically-decremented allowance with replay-safe granting.
 *
 * ONE ROW PER MONTH BOUGHT. A 6-month package inserts six rows whose windows run
 * back-to-back. That is what makes allowances NON-AGGREGATING: month 2 begins
 * exactly when month 1 expires, so month 1's unspent requests die with it and no
 * carry-over logic exists anywhere. `sequence` is the month's 0-based index
 * within its purchase.
 *
 * CONSUMABLE. `remaining` starts at `totalAllowance` and is decremented by a
 * guarded `UPDATE ... WHERE remaining > 0`, so two requests submitted at the same
 * instant can never drive it below zero.
 *
 * REFUNDABLE ON FAILURE. A render that dies after 2 hours must not also cost a
 * monthly slot, so a failed pipeline returns its token (see
 * `VideoQuotaService.refundRequest`). The refund is keyed on the request, so a
 * retry cannot refund the same request twice.
 *
 * Nothing here renews. When the last window expires the account simply falls back
 * to the free allowance.
 */
export interface VideoAllowanceWindow {
  id: string;
  userId: string;
  productCode: VideoProductCode;
  /**
   * Idempotency key for the purchase that granted this run of windows. Unique
   * together with `sequence`, so a double-clicked checkout returns the existing
   * windows instead of granting a second run for one payment.
   */
  purchaseId: string;
  /** 0-based index of this month within its purchase. */
  sequence: number;
  /** credit_transactions.id for the debit that paid for the purchase. */
  creditTransactionId: string | null;
  /** Requests this month is worth. Immutable. */
  totalAllowance: number;
  /** Requests still available this month. */
  remaining: number;
  startsAt: Date;
  /** After this instant, unspent requests are forfeit. */
  expiresAt: Date;
  status: VideoAllowanceWindowStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** True when a request can be drawn from this window right now. */
export function isWindowSpendable(
  window: Pick<
    VideoAllowanceWindow,
    "status" | "remaining" | "startsAt" | "expiresAt"
  >,
  now: Date = new Date()
): boolean {
  return (
    window.status === VideoAllowanceWindowStatus.Active &&
    window.remaining > 0 &&
    window.startsAt.getTime() <= now.getTime() &&
    window.expiresAt.getTime() > now.getTime()
  );
}

export interface CreateVideoAllowanceWindowInput {
  userId: string;
  productCode: VideoProductCode;
  purchaseId: string;
  sequence: number;
  creditTransactionId: string | null;
  totalAllowance: number;
  startsAt: Date;
  expiresAt: Date;
}
