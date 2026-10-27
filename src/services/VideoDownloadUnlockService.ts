import type { Pool, PoolClient } from "pg";
import { pool } from "@/lib/db";
import { VIDEO_DOWNLOAD_UNLOCK } from "@/config/requestLimits";
import { addDays } from "@/config/retention";

/**
 * One-time credit purchase to unlock download for a single free request.
 *
 * Idempotent: if a `video_download_unlock` transaction already exists for
 * this user+request, the second call returns the current unlock state without
 * debiting again. The debit and the request unlock happen in ONE database
 * transaction, so partial state is impossible.
 *
 * Channel Management is NOT granted — only download. The unlock does not
 * create a management access pass or a video allowance window, so
 * VideoAccessService.hasActivePackage() stays false for the account.
 */

/** The request is already unlocked; nothing was charged. Routes map this to 409. */
export class VideoAlreadyUnlockedError extends Error {
  readonly code = "already_unlocked";
  constructor() {
    super("This video is already unlocked for download.");
    this.name = "VideoAlreadyUnlockedError";
  }
}

/** The wallet cannot cover the unlock; nothing was charged. Routes map this to 402. */
export class VideoUnlockInsufficientCreditsError extends Error {
  readonly code = "insufficient_credits";
  constructor(readonly requiredCredits: number, readonly balanceCredits: number) {
    super(`Unlocking this video costs ${requiredCredits} credits; the balance is ${balanceCredits}.`);
    this.name = "VideoUnlockInsufficientCreditsError";
  }
}

/** The request has expired and cannot be unlocked. Routes map this to 422. */
export class VideoUnlockExpiredError extends Error {
  readonly code = "request_expired";
  constructor() {
    super("This video has expired and can no longer be unlocked.");
    this.name = "VideoUnlockExpiredError";
  }
}

export interface VideoDownloadUnlockResult {
  /** True when the call debited credits; false when already unlocked (idempotent). */
  charged: boolean;
  creditsSpent: number;
  balanceCredits: number;
  /** When download access expires; null for a new request until delivery. */
  unlockedUntil: Date | null;
}

type Db = Pick<Pool, "connect" | "query">;

const CHECK_UNLOCK_SQL = `
  SELECT COUNT(*)::int AS n
    FROM credit_transactions
   WHERE user_id = $1
     AND reference_id = $2
     AND type = 'video_download_unlock'`;

/**
 * Fetches the original video_download_unlock charge for a request.
 * Returns (user_id, amount_charged) or null if no row exists.
 */
const GET_UNLOCK_CHARGE_SQL = `
  SELECT user_id, ABS(amount)::int AS amount_charged
    FROM credit_transactions
   WHERE reference_id = $1
     AND type = 'video_download_unlock'
   LIMIT 1`;

/**
 * Description prefix used to identify a single-unlock render-failure refund.
 * Matched with LIKE 'Refund: single video unlock%' in idempotency checks, so
 * any future variants (e.g. localised descriptions) that share this prefix are
 * still counted and will not cause a double refund.
 */
const SINGLE_UNLOCK_REFUND_DESC = "Refund: single video unlock (render failed)";

/**
 * Checks under the wallet lock whether a refund for this request has already
 * been issued by this path (idempotency guard). The description prefix is what
 * distinguishes this refund from a manual admin request_refund on the same
 * request, which would have a different description.
 */
const CHECK_SINGLE_UNLOCK_REFUND_SQL = `
  SELECT COUNT(*)::int AS n
    FROM credit_transactions
   WHERE user_id = $1
     AND reference_id = $2
     AND type = 'request_refund'
     AND description LIKE 'Refund: single video unlock%'`;

export class VideoDownloadUnlockService {
  constructor(private readonly db: Db = pool) {}

  /**
   * Unlock download for `requestId` by debiting `userId`'s wallet once.
   *
   * Idempotency: if a `video_download_unlock` ledger row already exists for
   * this user+request, returns the current state without a second charge.
   */
  async purchase(params: {
    userId: string;
    requestId: string;
    /** Current expiry from the request, or null if not yet delivered. */
    currentExpiry: Date | null;
    /** Caller snapshot for compatibility; the locked database row is authoritative. */
    alreadyUnlocked: boolean;
    /** Submit a paid standalone request atomically, without using any quota. */
    submitNew?: boolean;
    now?: Date;
  }): Promise<VideoDownloadUnlockResult> {
    const now = params.now ?? new Date();
    const price = VIDEO_DOWNLOAD_UNLOCK.priceCredits;

    // If expired, refuse immediately.
    if (params.currentExpiry && params.currentExpiry.getTime() <= now.getTime()) {
      throw new VideoUnlockExpiredError();
    }

    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");

      // Re-check ownership and eligibility under a row lock, including races
      // with retention or another submission. Caller snapshots are not authority.
      const locked = await client.query<{ status: string; pricing_tier: string; download_unlocked: boolean; videos_expire_at: Date | null }>(
        `SELECT status, pricing_tier, download_unlocked, videos_expire_at
           FROM clip_requests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [params.requestId, params.userId]
      );
      const request = locked.rows[0];
      if (!request) throw new Error("Request not found.");
      if (["auto_cancelled", "rejected"].includes(request.status) ||
          (request.videos_expire_at && new Date(request.videos_expire_at).getTime() <= now.getTime())) {
        throw new VideoUnlockExpiredError();
      }
      if (params.submitNew ? (request.status !== "draft" && !request.download_unlocked) : request.status === "draft") {
        throw new Error("Only Draft requests can be submitted; drafts cannot be unlocked here.");
      }
      if (!request.download_unlocked && request.pricing_tier !== "free") {
        throw new Error("Only free requests can be unlocked.");
      }

      // Lock wallet to serialise concurrent calls.
      const walletResult = await client.query<{ id: string; balance: number }>(
        `SELECT id, balance FROM credit_wallets WHERE user_id = $1 FOR UPDATE`,
        [params.userId]
      );
      const wallet = walletResult.rows[0];

      // Idempotency: check for an existing unlock transaction under the lock.
      const existingResult = await client.query<{ n: number }>(CHECK_UNLOCK_SQL, [
        params.userId,
        params.requestId,
      ]);
      if (request.download_unlocked || Number(existingResult.rows[0]?.n ?? 0) > 0) {
        await client.query("ROLLBACK");
        const unlockedUntil = request.videos_expire_at ? new Date(request.videos_expire_at) : null;
        return { charged: false, creditsSpent: 0, balanceCredits: wallet ? Number(wallet.balance) : 0, unlockedUntil };
      }

      const balance = wallet ? Number(wallet.balance) : 0;
      if (!wallet || balance < price) {
        throw new VideoUnlockInsufficientCreditsError(price, balance);
      }

      const debited = await client.query<{ balance: number }>(
        `UPDATE credit_wallets
            SET balance = balance - $1, updated_at = NOW()
          WHERE id = $2 AND balance >= $1
        RETURNING balance`,
        [price, wallet.id]
      );
      if (!debited.rows[0]) {
        throw new VideoUnlockInsufficientCreditsError(price, balance);
      }

      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description, reference_id)
         VALUES ($1, $2, 'video_download_unlock', $3, $4)`,
        [params.userId, -price, `Download unlock for request (${price} credits)`, params.requestId]
      );

      const unlockedUntil = addDays(now, VIDEO_DOWNLOAD_UNLOCK.days);
      await client.query(
        `UPDATE clip_requests
            SET download_unlocked = true,
                videos_expire_at  = $1
          WHERE id = $2`,
        // New requests start their 30 days on delivery (existing delivery
        // stamping handles a null expiry). Existing videos start on purchase.
        [params.submitNew ? null : unlockedUntil, params.requestId]
      );

      if (params.submitNew) {
        await client.query(
          `UPDATE clip_requests SET status = 'submitted', submitted_at = $1,
             pricing_tier = 'paid', is_trial_request = false,
             credit_confirmed = true, rights_confirmed = true,
             ai_processing_confirmed = true, ai_consent_version = '1.0.0',
             ai_consent_accepted_at = $1 WHERE id = $2`, [now, params.requestId]
        );
        await client.query(
          `INSERT INTO request_status_history (request_id, status, note, changed_at)
           VALUES ($1, 'submitted', 'Standalone download purchase', $2)`, [params.requestId, now]
        );
      }

      await client.query("COMMIT");
      return {
        charged: true,
        creditsSpent: price,
        balanceCredits: Number(debited.rows[0].balance),
        unlockedUntil: params.submitNew ? null : unlockedUntil,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Refund the video_download_unlock charge when a single-unlock new request
   * fails to render.
   *
   * A "single-unlock new request" is one submitted via purchase({ submitNew: true })
   * — it has a video_download_unlock ledger row, pricing_tier='paid', and NO
   * video_allowance_window_id (unlike package requests). Only THOSE requests get
   * a credit back on render failure; free requests, package requests, and
   * requests that delivered successfully are left alone.
   *
   * IDEMPOTENCY. The check for an existing refund row (matching description prefix)
   * is performed under the wallet FOR UPDATE lock, so two concurrent failure
   * callbacks cannot each insert a refund row. A description-prefix match is used
   * rather than a plain reference_id + type check because a manual admin
   * request_refund for the same request would share the same type and reference
   * and must NOT prevent this automatic refund from being issued.
   *
   * NON-THROWING. Returns true when the refund was issued, false when skipped
   * (not applicable, already done, or request was delivered). Callers should
   * wrap in try/catch and log any thrown error, consistent with _refundAllowance.
   */
  async refundSingleUnlock(requestId: string): Promise<boolean> {
    // Quick pre-check: is there a video_download_unlock charge for this request?
    // Avoids opening a transaction for non-unlock requests.
    const chargeResult = await this.db.query<{ user_id: string; amount_charged: number }>(
      GET_UNLOCK_CHARGE_SQL,
      [requestId]
    );
    const chargeRow = chargeResult.rows[0];
    if (!chargeRow) return false;

    const { user_id: userId, amount_charged: refundAmount } = chargeRow;

    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");

      // Lock the request row; verify it has no allowance window (single-unlock
      // path, not a package) and has not been delivered. Delivered requests
      // rendered successfully — no refund.
      const reqResult = await client.query<{
        video_allowance_window_id: string | null;
        status: string;
        pricing_tier: string;
      }>(
        `SELECT video_allowance_window_id, status, pricing_tier
           FROM clip_requests WHERE id = $1 FOR UPDATE`,
        [requestId]
      );
      const req = reqResult.rows[0];
      // Only NEW paid unlock requests (submitNew sets pricing_tier = 'paid'); an
      // existing free video unlocked later stays pricing_tier 'free' and is never
      // refunded here.
      if (
        !req ||
        req.pricing_tier !== "paid" ||
        req.video_allowance_window_id !== null ||
        ["delivered", "published", "scheduled_for_publishing"].includes(req.status)
      ) {
        await client.query("ROLLBACK");
        return false;
      }

      // Lock wallet to serialise concurrent refund attempts.
      const walletResult = await client.query<{ id: string; balance: number }>(
        `SELECT id, balance FROM credit_wallets WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      const wallet = walletResult.rows[0];
      if (!wallet) {
        await client.query("ROLLBACK");
        return false;
      }

      // Idempotency: if a single-unlock refund row already exists for this
      // request, do nothing. Checked under the lock so concurrent calls cannot
      // both pass this gate.
      const existingResult = await client.query<{ n: number }>(
        CHECK_SINGLE_UNLOCK_REFUND_SQL,
        [userId, requestId]
      );
      if (Number(existingResult.rows[0]?.n ?? 0) > 0) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description, reference_id)
         VALUES ($1, $2, 'request_refund', $3, $4)`,
        [userId, refundAmount, SINGLE_UNLOCK_REFUND_DESC, requestId]
      );
      await client.query(
        `UPDATE credit_wallets SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
        [refundAmount, wallet.id]
      );

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

export const videoDownloadUnlockService = new VideoDownloadUnlockService();
