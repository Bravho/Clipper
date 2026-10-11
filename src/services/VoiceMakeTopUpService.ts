import type { Pool, PoolClient } from "pg";

import { MAX_VOICE_MAKES_PER_REQUEST, VOICE_MAKE_TOP_UP } from "@/config/requestLimits";
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
 * checked under the wallet lock with the packs already bought counted inside
 * the transaction. A double tap, a retry after a lost response, or two phones
 * pressing at once therefore buy exactly one pack: the second call finds makes
 * left and is refused without a charge.
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

const COUNT_PACKS_SQL = `SELECT COUNT(*)::int AS packs
   FROM credit_transactions
  WHERE reference_id = $1 AND type = 'voice_make_top_up'`;

/** The allowance a request has after buying `packs` packs. */
export function voiceMakeLimitForPacks(packs: number): number {
  return MAX_VOICE_MAKES_PER_REQUEST + Math.max(0, packs) * VOICE_MAKE_TOP_UP.makes;
}

export class VoiceMakeTopUpService {
  constructor(private readonly db: Db = pool) {}

  /** How many packs this request has bought (0 when none). */
  async packsBought(requestId: string): Promise<number> {
    const result = await this.db.query<{ packs: number }>(COUNT_PACKS_SQL, [requestId]);
    return Number(result.rows[0]?.packs ?? 0);
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
      // pack count read below cannot be stale.
      const walletResult = await client.query<{ id: string; balance: number }>(
        `SELECT id, balance FROM credit_wallets WHERE user_id = $1 FOR UPDATE`,
        [params.userId]
      );
      const wallet = walletResult.rows[0];

      const packsResult = await client.query<{ packs: number }>(COUNT_PACKS_SQL, [
        params.requestId,
      ]);
      const limit = voiceMakeLimitForPacks(Number(packsResult.rows[0]?.packs ?? 0));
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
