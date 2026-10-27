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
}

export const videoDownloadUnlockService = new VideoDownloadUnlockService();
