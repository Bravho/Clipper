import type { Pool, PoolClient } from "pg";

import {
  MAX_VOICE_MAKES_PER_REQUEST,
  VOICE_MAKE_TOP_UP,
  makesForTopUpAmount,
} from "@/config/requestLimits";
import { pool } from "@/lib/db";

/**
 * More voice makes for one request, bought with credits.
 *
 * A phone-made request includes MAX_VOICE_MAKES_PER_REQUEST ElevenLabs makes.
 * When they are used up the requester may buy VOICE_MAKE_TOP_UP.makes more
 * for VOICE_MAKE_TOP_UP.priceCredits. Each purchase is one immutable
 * `credit_transactions` row (type `voice_make_top_up`, reference = request),
 * written in the SAME database transaction as the wallet debit, so a buyer can
 * never be charged without the makes or get the makes without the charge.
 *
 * ONE PACK AT A TIME. A pack is sold only while the request has no makes left,
 * checked under the wallet lock with the purchased makes counted inside the
 * transaction. A double tap, a retry after a lost response, or two phones
 * pressing at once therefore buy exactly one pack: the second call finds makes
 * left and is refused without a charge.
 *
 * LEGACY PACKS. Production has rows at amount=−49 and amount=−29, each
 * granting +5 makes. The allowance is derived from the ledger row amounts via
 * makesForTopUpAmount() (config/requestLimits.ts), so changing the current
 * price never retroactively reduces existing buyers' makes.
 */

/** The request still has makes; nothing was charged. Routes map this to 409. */
export class VoiceMakesStillLeftError extends Error {
  readonly code = "voice_makes_still_left";
  constructor(readonly used: number, readonly limit: number) {
    super(`This video still has ${limit - used} of ${limit} voice makes left.`);
    this.name = "VoiceMakesStillLeftError";
  }
}

/** The wallet cannot cover a pack; nothing was charged. Routes map this to 402. */
export class VoiceMakeTopUpCreditsError extends Error {
  readonly code = "insufficient_credits";
  constructor(readonly requiredCredits: number, readonly balanceCredits: number) {
    super(
      `More voice makes cost ${requiredCredits} credits; the balance is ${balanceCredits}.`
    );
    this.name = "VoiceMakeTopUpCreditsError";
  }
}

export interface VoiceMakeTopUpResult {
  /** The request's allowance after the purchase. */
  limit: number;
  creditsSpent: number;
  balanceCredits: number;
}

type Db = Pick<Pool, "connect" | "query">;

/**
 * Fetches the ABS(amount) for every voice_make_top_up row for this request so
 * the allowance can be derived per-row via makesForTopUpAmount(). Counts packs
 * by their historical charge rather than by count, preserving legacy buyers.
 */
const GET_PACK_AMOUNTS_SQL = `
  SELECT ABS(amount)::int AS amount_charged
    FROM credit_transactions
   WHERE reference_id = $1 AND type = 'voice_make_top_up'`;

/** The allowance a request has after purchasing the given total top-up makes. */
export function voiceMakeLimitForPurchasedMakes(purchasedMakes: number): number {
  return MAX_VOICE_MAKES_PER_REQUEST + Math.max(0, purchasedMakes);
}

export class VoiceMakeTopUpService {
  constructor(private readonly db: Db = pool) {}

  /**
   * Total top-up makes this request has purchased (0 when none).
   * Sums makes per ledger row via makesForTopUpAmount so legacy packs (bought
   * at 49 or 29 credits for +5 makes each) are honoured correctly.
   */
  async purchasedMakes(requestId: string): Promise<number> {
    const result = await this.db.query<{ amount_charged: number }>(
      GET_PACK_AMOUNTS_SQL,
      [requestId]
    );
    return result.rows.reduce(
      (sum, row) => sum + makesForTopUpAmount(Number(row.amount_charged)),
      0
    );
  }

  /**
   * Buy one pack for a request whose makes are used up.
   *
   * `usedMakes` is the request's count of voices ElevenLabs actually made
   * (VideoGenerationService.countVoiceMakes) — the caller has already checked
   * that the request belongs to `userId` and that its voice can still be made.
   */
  async purchase(params: {
    userId: string;
    requestId: string;
    usedMakes: number;
  }): Promise<VoiceMakeTopUpResult> {
    const price = VOICE_MAKE_TOP_UP.priceCredits;
    const client: PoolClient = await this.db.connect();
    try {
      await client.query("BEGIN");

      // Lock the wallet first: it serialises this user's purchases, so the
      // pack amounts read below cannot be stale.
      const walletResult = await client.query<{ id: string; balance: number }>(
        `SELECT id, balance FROM credit_wallets WHERE user_id = $1 FOR UPDATE`,
        [params.userId]
      );
      const wallet = walletResult.rows[0];

      // Read all existing pack amounts inside the transaction and sum the
      // makes they represent. Legacy rows (amount=49 or 29) contribute their
      // original +5 makes each so existing buyers are not affected.
      const packRows = await client.query<{ amount_charged: number }>(
        GET_PACK_AMOUNTS_SQL,
        [params.requestId]
      );
      const purchased = packRows.rows.reduce(
        (sum, row) => sum + makesForTopUpAmount(Number(row.amount_charged)),
        0
      );
      const limit = voiceMakeLimitForPurchasedMakes(purchased);
      if (params.usedMakes < limit) {
        await client.query("ROLLBACK");
        throw new VoiceMakesStillLeftError(params.usedMakes, limit);
      }

      const balance = wallet ? Number(wallet.balance) : 0;
      if (!wallet || balance < price) {
        await client.query("ROLLBACK");
        throw new VoiceMakeTopUpCreditsError(price, balance);
      }

      const debited = await client.query<{ balance: number }>(
        `UPDATE credit_wallets
            SET balance = balance - $1, updated_at = NOW()
          WHERE id = $2 AND balance >= $1
        RETURNING balance`,
        [price, wallet.id]
      );
      if (!debited.rows[0]) {
        await client.query("ROLLBACK");
        throw new VoiceMakeTopUpCreditsError(price, balance);
      }

      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description, reference_id)
         VALUES ($1, $2, 'voice_make_top_up', $3, $4)`,
        [
          params.userId,
          -price,
          `${VOICE_MAKE_TOP_UP.makes} more voice makes (${price} credits)`,
          params.requestId,
        ]
      );

      await client.query("COMMIT");
      return {
        limit: limit + VOICE_MAKE_TOP_UP.makes,
        creditsSpent: price,
        balanceCredits: Number(debited.rows[0].balance),
      };
    } catch (err) {
      if (!(err instanceof VoiceMakesStillLeftError) && !(err instanceof VoiceMakeTopUpCreditsError)) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export const voiceMakeTopUpService = new VoiceMakeTopUpService();
