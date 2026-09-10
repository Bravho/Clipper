import type {
  VideoAllowanceWindow,
  CreateVideoAllowanceWindowInput,
} from "@/domain/models/VideoAllowanceWindow";

/**
 * Data access for purchased monthly video allowances.
 *
 * Mirrors IManagementUploadBundleRepository's contract — replay-safe granting,
 * atomic consumption, timestamp-decided spendability — because the two solve the
 * same problem and diverging would mean two sets of race conditions to reason
 * about.
 */
export interface IVideoAllowanceWindowRepository {
  /**
   * Grant a purchase's run of monthly windows, or return the existing rows when
   * that purchase has already been granted (UNIQUE(purchase_id, sequence)).
   * `created` tells the caller whether this call performed the grant, so a
   * replayed checkout never grants a second run for one payment.
   */
  createOrGetByPurchase(input: {
    purchaseId: string;
    windows: CreateVideoAllowanceWindowInput[];
  }): Promise<{ windows: VideoAllowanceWindow[]; created: boolean }>;

  findById(id: string): Promise<VideoAllowanceWindow | null>;
  findByUserId(userId: string): Promise<VideoAllowanceWindow[]>;

  /**
   * The window a request should be drawn from now: active, in-window, with
   * requests left. Null when the account has no live paid allowance, which is
   * what sends the caller to the free tier.
   */
  findSpendable(userId: string, now: Date): Promise<VideoAllowanceWindow | null>;

  /**
   * The furthest expiry across the user's live windows, or null.
   *
   * A purchase made while paid time is still running starts there rather than at
   * "now", so buying early never destroys time already paid for.
   */
  latestExpiry(userId: string, now: Date): Promise<Date | null>;

  /**
   * Atomically take ONE request from the user's current window.
   *
   * Returns the window id that paid for it, or null when nothing was spendable —
   * so this doubles as the final, race-proof guard behind the quota check. A
   * guarded `UPDATE ... WHERE remaining > 0` means two simultaneous submissions
   * cannot both succeed on the last request of a month.
   */
  consumeOne(userId: string, now: Date): Promise<string | null>;

  /**
   * Return one request to a window after a failed render.
   *
   * Never takes `remaining` above `totalAllowance`, so a double refund cannot
   * manufacture allowance. Refunding an expired window is a no-op: the month is
   * gone, and resurrecting it would hand out capacity outside the paid period.
   */
  refundOne(windowId: string): Promise<void>;

  /**
   * Flip elapsed `active` windows to `expired`. Housekeeping only — spendability
   * is decided by comparing timestamps, so quotas are correct even if this has
   * never run.
   */
  markElapsedExpired(now: Date): Promise<number>;
}
