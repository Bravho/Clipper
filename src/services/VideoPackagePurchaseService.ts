import { randomUUID } from "crypto";
import {
  findVideoPackage,
  expandPackageWindows,
  REQUESTS_PER_PAID_MONTH,
} from "@/config/videoPackages";
import type { VideoProductCode } from "@/domain/enums/VideoProductCode";
import type { VideoAllowanceWindow } from "@/domain/models/VideoAllowanceWindow";
import { videoAllowanceWindowRepository } from "@/repositories";
import { creditService } from "@/services/CreditService";

/**
 * `credit_transactions.reference_id` is a UUID column, so only a purchase id
 * that IS a uuid may be written to it. Idempotency tokens are free-form strings
 * by design — they are the replay key in `video_allowance_windows.purchase_id`,
 * which is TEXT — so one that is not a uuid is recorded as no reference rather
 * than being forced into a column that will reject it. Getting this wrong made
 * every checkout 500 with "invalid input syntax for type uuid".
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when the wallet cannot cover the package. */
export class InsufficientCreditsForPackageError extends Error {
  constructor(
    readonly required: number,
    readonly balance: number
  ) {
    super(
      `Insufficient credits: ${required} needed, ${balance} available.`
    );
    this.name = "InsufficientCreditsForPackageError";
  }
}

export class UnknownVideoPackageError extends Error {
  constructor(code: string) {
    super(`Unknown video package: ${code}`);
    this.name = "UnknownVideoPackageError";
  }
}

export interface VideoPackagePurchaseResult {
  charged: boolean;
  creditsSpent: number;
  windows: VideoAllowanceWindow[];
  /** When the last purchased month lapses. */
  activeUntil: Date;
}

/**
 * Buying a video package.
 *
 * Mirrors ManagementPurchaseService: a wallet debit against the trusted
 * server-side catalogue, never a client-supplied price. There is no new payment
 * provider, no subscription object and no renewal timer — money enters only
 * through the platform's own billing when credits are topped up, which is what
 * keeps App Store and Play Store policy satisfied.
 *
 * STACKING, NOT REPLACING. A purchase made while paid time is still running
 * starts at the current expiry, so buying early never destroys time already paid
 * for. Each month is its own allowance window, so the 10 requests do not
 * aggregate across months.
 *
 * IDEMPOTENT. `idempotencyToken` (or a generated one) keys the granted windows;
 * a double-clicked checkout returns the existing months and charges nothing.
 */
export class VideoPackagePurchaseService {
  async purchase(
    userId: string,
    productCode: VideoProductCode,
    idempotencyToken?: string
  ): Promise<VideoPackagePurchaseResult> {
    const pkg = findVideoPackage(productCode);
    if (!pkg) throw new UnknownVideoPackageError(productCode);

    const purchaseId = idempotencyToken ?? randomUUID();
    const now = new Date();

    // Replay check FIRST: if this purchase already granted its months, return
    // them and charge nothing. Doing it before the debit is what makes a
    // double-click harmless.
    const existing = await videoAllowanceWindowRepository.createOrGetByPurchase({
      purchaseId,
      windows: [],
    });
    if (existing.windows.length > 0) {
      return {
        charged: false,
        creditsSpent: 0,
        windows: existing.windows,
        activeUntil: existing.windows[existing.windows.length - 1].expiresAt,
      };
    }

    const balance = await creditService.getBalance(userId);
    if (balance < pkg.priceCredits) {
      throw new InsufficientCreditsForPackageError(pkg.priceCredits, balance);
    }

    // Start where the user's paid time currently ends, so buying a second
    // package extends rather than overwrites.
    //
    // BUT only while the paid time is actually usable today. If nothing can be
    // spent right now (the live month is used up, or every bought month starts
    // in the future), the new package starts NOW. Stacking behind a month with
    // 0 requests left parked every new purchase weeks in the future, so the
    // account stayed on "free — 0 of 3 left" however many packages were bought.
    const usableNow = await videoAllowanceWindowRepository.findSpendable(userId, now);
    const startFrom = usableNow
      ? ((await videoAllowanceWindowRepository.latestExpiry(userId, now)) ?? now)
      : now;

    const wallet = await creditService.deductCredits(
      userId,
      pkg.priceCredits,
      `Video package: ${pkg.code}`,
      UUID_RE.test(purchaseId) ? purchaseId : undefined
    );
    void wallet;

    const specs = expandPackageWindows(pkg, startFrom).map((w, i) => ({
      userId,
      productCode: pkg.code,
      purchaseId,
      sequence: i,
      creditTransactionId: null,
      totalAllowance: REQUESTS_PER_PAID_MONTH,
      startsAt: w.startsAt,
      expiresAt: w.expiresAt,
    }));

    let granted: { windows: VideoAllowanceWindow[]; created: boolean };
    try {
      granted = await videoAllowanceWindowRepository.createOrGetByPurchase({
        purchaseId,
        windows: specs,
      });
    } catch (err) {
      // The debit has already happened. If the months could not be written,
      // give the credits back rather than leave the user charged for nothing.
      await creditService
        .refundCredits(
          userId,
          pkg.priceCredits,
          `Refund: video package ${pkg.code} could not be granted`,
          UUID_RE.test(purchaseId) ? purchaseId : undefined
        )
        .catch((refundErr) =>
          console.error("[VideoPackagePurchase] refund after failed grant failed", refundErr)
        );
      throw err;
    }

    return {
      charged: granted.created,
      creditsSpent: granted.created ? pkg.priceCredits : 0,
      windows: granted.windows,
      activeUntil: granted.windows[granted.windows.length - 1].expiresAt,
    };
  }
}

export const videoPackagePurchaseService = new VideoPackagePurchaseService();
