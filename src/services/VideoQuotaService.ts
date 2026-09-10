import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
  freeWindowStart,
} from "@/config/videoPackages";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import {
  clipRequestRepository,
  videoAllowanceWindowRepository,
} from "@/repositories";

/**
 * Thrown when an account has neither a free slot nor a paid one left.
 *
 * Carries when the free allowance next frees a slot, so the UI can say "your
 * next free video is available on 14 October" instead of a bare refusal. Null
 * when the account has never submitted anything (which cannot happen here) or
 * the date is unknown.
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
  /** Size of that allowance, for "2 of 3 left". */
  total: number;
  /** When the current allowance lapses: the paid window's expiry, or the date
   *  the oldest counted free request falls out of the rolling window. */
  renewsAt: Date | null;
  /** The paid window that would pay for the next request, if any. */
  allowanceWindowId: string | null;
  /** False when the next request would be refused. */
  canSubmit: boolean;
}

/**
 * VideoQuotaService — how many videos an account may make, and on whose ticket.
 *
 * THE MODEL. Render capacity is the scarce resource (one clip is 2–3 hours on a
 * single worker), so access is a monthly quota rather than a per-request price:
 *
 *   Free — 3 requests per rolling 30 days, LOW render priority.
 *   Paid — a prepaid package grants 10 requests per month, HIGH priority.
 *
 * Paid is always preferred while a window is live: a subscriber who has paid for
 * this month should get the faster queue, and their free allowance is still there
 * afterwards.
 *
 * The free side stores nothing. It is derived from submitted requests in the last
 * 30 days, so there is no anchor date, no reset job, no per-user bookkeeping, and
 * nothing to drift out of sync.
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

    const usedFree = await clipRequestRepository.countSubmittedRequestsByUserId(
      userId,
      freeWindowStart(now)
    );
    const remaining = Math.max(0, FREE_REQUESTS_PER_WINDOW - usedFree);

    return {
      tier: RequestPricingTier.Free,
      remaining,
      total: FREE_REQUESTS_PER_WINDOW,
      renewsAt: remaining > 0 ? null : await this.nextFreeSlotAt(userId, now),
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

    const usedFree = await clipRequestRepository.countSubmittedRequestsByUserId(
      userId,
      freeWindowStart(now)
    );
    if (usedFree < FREE_REQUESTS_PER_WINDOW) {
      return { tier: RequestPricingTier.Free, allowanceWindowId: null };
    }

    throw new QuotaExhaustedError(
      `Monthly limit reached: ${FREE_REQUESTS_PER_WINDOW} free videos per ${FREE_WINDOW_DAYS} days.`,
      await this.nextFreeSlotAt(userId, now)
    );
  }

  /**
   * Give a request back after a failed render.
   *
   * A job that dies two hours in must not also cost a monthly slot — that is a
   * support ticket every time. Free-tier requests need nothing: their allowance
   * is derived from submissions, and the failed one ages out of the rolling
   * window on its own.
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

  /**
   * When the oldest counted free submission falls out of the rolling window —
   * i.e. the moment a free slot reappears.
   *
   * Only meaningful once the allowance is spent, which is the only time it is
   * called.
   */
  private async nextFreeSlotAt(
    userId: string,
    now: Date
  ): Promise<Date | null> {
    const submitted = (await clipRequestRepository.findByUserId(userId))
      .filter((r) => r.submittedAt !== null)
      .sort(
        (a, b) =>
          (a.submittedAt as Date).getTime() - (b.submittedAt as Date).getTime()
      );

    const windowStart = freeWindowStart(now);
    const inWindow = submitted.filter(
      (r) => (r.submittedAt as Date).getTime() >= windowStart.getTime()
    );
    if (inWindow.length < FREE_REQUESTS_PER_WINDOW) return null;

    // The n-th most recent request is what is holding the allowance down; a slot
    // opens exactly 30 days after it.
    const blocking = inWindow[inWindow.length - FREE_REQUESTS_PER_WINDOW];
    return new Date(
      (blocking.submittedAt as Date).getTime() + FREE_WINDOW_DAYS * 86_400_000
    );
  }
}

export const videoQuotaService = new VideoQuotaService();
