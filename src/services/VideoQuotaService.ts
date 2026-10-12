import { FREE_REQUESTS_TOTAL } from "@/config/videoPackages";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import {
  clipRequestRepository,
  videoAllowanceWindowRepository,
} from "@/repositories";

/**
 * Thrown when an account has neither a free slot nor a paid one left.
 *
 * `nextFreeSlotAt` is kept for older app builds that read it; it is always null
 * now, because the free allowance never comes back (2 requests per account).
 */
export class QuotaExhaustedError extends Error {
  constructor(
    message: string,
    readonly nextFreeSlotAt: Date | null
  ) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

/** What the account's NEXT request may draw on. */
export interface VideoQuota {
  tier: RequestPricingTier;
  /** Requests left in the allowance the next request would use. */
  remaining: number;
  /** Size of that allowance, for "1 of 2 left". */
  total: number;
  /** When the current allowance lapses: the paid window's expiry. Null on the
   *  free tier, which never renews. */
  renewsAt: Date | null;
  /** The paid window that would pay for the next request, if any. */
  allowanceWindowId: string | null;
  /** False when the next request would be refused. */
  canSubmit: boolean;
}

/**
 * VideoQuotaService — how many videos an account may make, and on whose ticket.
 *
 * THE MODEL (2026-10-12):
 *
 *   Free — 2 requests per account, ever. Their videos stay in the app until a
 *          package is bought (VideoAccessService).
 *   Paid — a prepaid package grants 5 or 10 requests per month.
 *
 * Paid is always preferred while a window is live: a subscriber's monthly
 * requests are used first and the free ones are left for later.
 *
 * The free side stores nothing. It is counted from the account's submitted
 * free requests, so there is no reset job and nothing to drift out of sync.
 */
export class VideoQuotaService {
  /**
   * What the next request would draw on, without consuming anything.
   *
   * Read-only — safe for dashboards and the pricing page. `consume()` re-checks
   * atomically, so a quota that changes between this call and submission cannot
   * oversell.
   */
  async getQuota(userId: string, now: Date = new Date()): Promise<VideoQuota> {
    const paidWindow = await videoAllowanceWindowRepository.findSpendable(
      userId,
      now
    );

    if (paidWindow) {
      return {
        tier: RequestPricingTier.Paid,
        remaining: paidWindow.remaining,
        total: paidWindow.totalAllowance,
        renewsAt: paidWindow.expiresAt,
        allowanceWindowId: paidWindow.id,
        canSubmit: true,
      };
    }

    const usedFree = await clipRequestRepository.countFreeRequestsByUserId(userId);
    const remaining = Math.max(0, FREE_REQUESTS_TOTAL - usedFree);

    return {
      tier: RequestPricingTier.Free,
      remaining,
      total: FREE_REQUESTS_TOTAL,
      renewsAt: null,
      allowanceWindowId: null,
      canSubmit: remaining > 0,
    };
  }

  /**
   * Take one request from the account's allowance, or refuse.
   *
   * Returns the tier the request was drawn against and the window that paid for
   * it (null on the free tier). Throws {@link QuotaExhaustedError} when nothing
   * is left.
   *
   * ORDER MATTERS. The paid window is decremented atomically FIRST; only if there
   * is no live paid allowance do we fall back to counting free submissions. That
   * makes the paid path race-proof — two simultaneous submissions cannot both
   * take a month's last request — while the free path is naturally bounded by
   * the count itself.
   */
  async consume(
    userId: string,
    now: Date = new Date()
  ): Promise<{ tier: RequestPricingTier; allowanceWindowId: string | null }> {
    const windowId = await videoAllowanceWindowRepository.consumeOne(userId, now);
    if (windowId) {
      return { tier: RequestPricingTier.Paid, allowanceWindowId: windowId };
    }

    const usedFree = await clipRequestRepository.countFreeRequestsByUserId(userId);
    if (usedFree < FREE_REQUESTS_TOTAL) {
      return { tier: RequestPricingTier.Free, allowanceWindowId: null };
    }

    throw new QuotaExhaustedError(
      `Free limit reached: ${FREE_REQUESTS_TOTAL} free videos per account. Buy a package to make more.`,
      null
    );
  }

  /**
   * Give a request back after a failed render.
   *
   * A job that dies two hours in must not also cost a monthly slot — that is a
   * support ticket every time. Free requests are not given back: a failed
   * request can still be retried or resumed, so refunding it would hand out a
   * third free video. (The free count does skip any request that WAS stamped
   * refunded, should support ever do that by hand.)
   *
   * Idempotent via `allowanceRefundedAt`, so a retry that fails again cannot
   * refund the same request twice.
   */
  async refundRequest(requestId: string): Promise<boolean> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) return false;
    if (!request.videoAllowanceWindowId) return false;
    if (request.allowanceRefundedAt) return false;

    await videoAllowanceWindowRepository.refundOne(request.videoAllowanceWindowId);
    // `update()` only accepts draft-editable fields; the refund stamp rides on
    // updateStatus with the request's CURRENT status, so nothing moves but the
    // one column.
    await clipRequestRepository.updateStatus(requestId, request.status, {
      allowanceRefundedAt: new Date(),
    });
    return true;
  }
}

export const videoQuotaService = new VideoQuotaService();
