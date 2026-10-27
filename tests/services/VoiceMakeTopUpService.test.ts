/**
 * Buying more voice makes with credits: one pack (+2 makes for 12 credits),
 * only when the makes are used up, debit and ledger row in ONE transaction.
 * Legacy packs (49 credits for +5, 29 credits for +5) must not lose their
 * makes after the price change — the allowance is computed per ledger row.
 *
 * Driven against a fake PoolClient that records every statement, the same way
 * VideoDownloadUnlockService.test.ts guards the single-unlock purchase.
 */
import {
  VoiceMakeTopUpService,
  VoiceMakeTopUpCreditsError,
  VoiceMakesStillLeftError,
  voiceMakeLimitForPurchasedMakes,
} from "@/services/VoiceMakeTopUpService";
import {
  MAX_VOICE_MAKES_PER_REQUEST,
  VOICE_MAKE_TOP_UP,
  makesForTopUpAmount,
} from "@/config/requestLimits";

const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";

/** Build a fake DB where packRows is the list of {amount_charged} for existing rows. */
function fakeDb(state: {
  balance: number;
  packRows?: Array<{ amount_charged: number }>;
  walletMissing?: boolean;
}) {
  const packRows: Array<{ amount_charged: number }> = state.packRows ? [...state.packRows] : [];
  const statements: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const text = sql.replace(/\s+/g, " ").trim();
      statements.push(text.split(" ").slice(0, 2).join(" "));
      if (text.startsWith("SELECT id, balance FROM credit_wallets")) {
        return { rows: state.walletMissing ? [] : [{ id: "w1", balance: state.balance }] };
      }
      if (text.startsWith("SELECT ABS(amount)")) {
        return { rows: packRows };
      }
      if (text.startsWith("UPDATE credit_wallets")) {
        const price = Number(params?.[0]);
        if (state.balance < price) return { rows: [] };
        state.balance -= price;
        return { rows: [{ balance: state.balance }] };
      }
      if (text.startsWith("INSERT INTO credit_transactions")) {
        // The charged amount is params[1] (negative); record as amount_charged
        const charged = Math.abs(Number(params?.[1]));
        packRows.push({ amount_charged: charged });
        expect(params).toEqual([
          USER_ID,
          -VOICE_MAKE_TOP_UP.priceCredits,
          expect.any(String),
          REQUEST_ID,
        ]);
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  // db.query handles purchasedMakes() calls outside a transaction
  const db = {
    connect: jest.fn(async () => client),
    query: jest.fn(async (sql: string) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT ABS(amount)")) return { rows: packRows };
      return { rows: [] };
    }),
  };
  return { db, client, statements, state, packRows };
}

describe("VoiceMakeTopUpService", () => {
  it("sells one pack (+2 makes for 12 credits) when the makes are used up", async () => {
    const { db, client, statements, state } = fakeDb({ balance: 100, packRows: [] });
    const service = new VoiceMakeTopUpService(db as never);
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      usedMakes: MAX_VOICE_MAKES_PER_REQUEST,
    });
    expect(result).toEqual({
      limit: MAX_VOICE_MAKES_PER_REQUEST + VOICE_MAKE_TOP_UP.makes,
      creditsSpent: VOICE_MAKE_TOP_UP.priceCredits,
      balanceCredits: 100 - VOICE_MAKE_TOP_UP.priceCredits,
    });
    expect(state.balance).toBe(100 - VOICE_MAKE_TOP_UP.priceCredits);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.indexOf("INSERT INTO")).toBeGreaterThan(statements.indexOf("UPDATE credit_wallets"));
    expect(statements[statements.length - 1]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });

  it("charges nothing while makes are left — a double tap buys one pack", async () => {
    const { db, state } = fakeDb({ balance: 500, packRows: [] });
    const service = new VoiceMakeTopUpService(db as never);
    const used = MAX_VOICE_MAKES_PER_REQUEST;
    await service.purchase({ userId: USER_ID, requestId: REQUEST_ID, usedMakes: used });
    await expect(
      service.purchase({ userId: USER_ID, requestId: REQUEST_ID, usedMakes: used })
    ).rejects.toBeInstanceOf(VoiceMakesStillLeftError);
    // Only one pack deducted
    expect(state.balance).toBe(500 - VOICE_MAKE_TOP_UP.priceCredits);
  });

  it("refuses without a charge when the wallet is short", async () => {
    const { db, client, state } = fakeDb({
      balance: VOICE_MAKE_TOP_UP.priceCredits - 1,
      packRows: [],
    });
    const service = new VoiceMakeTopUpService(db as never);
    await expect(
      service.purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        usedMakes: MAX_VOICE_MAKES_PER_REQUEST,
      })
    ).rejects.toBeInstanceOf(VoiceMakeTopUpCreditsError);
    expect(state.balance).toBe(VOICE_MAKE_TOP_UP.priceCredits - 1); // unchanged
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("sells a second pack once the first pack's makes are used up", async () => {
    // First new pack (12 credits, +2 makes) already on the ledger
    const { db, state } = fakeDb({
      balance: 500,
      packRows: [{ amount_charged: VOICE_MAKE_TOP_UP.priceCredits }],
    });
    const service = new VoiceMakeTopUpService(db as never);
    // purchased = 2 → limit = 3 + 2 = 5
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      usedMakes: voiceMakeLimitForPurchasedMakes(VOICE_MAKE_TOP_UP.makes),
    });
    // After second pack: purchased = 4 → limit = 3 + 4 = 7
    expect(result.limit).toBe(
      voiceMakeLimitForPurchasedMakes(2 * VOICE_MAKE_TOP_UP.makes)
    );
    expect(state.balance).toBe(500 - VOICE_MAKE_TOP_UP.priceCredits);
  });

  it("keeps +5 makes for a legacy 49-credit pack (existing buyers unaffected)", async () => {
    // A pack bought before the price change at 49 credits grants +5 makes
    const { db } = fakeDb({ balance: 500, packRows: [{ amount_charged: 49 }] });
    const service = new VoiceMakeTopUpService(db as never);
    // purchased = 5 (legacy) → limit = 3 + 5 = 8; usedMakes < 8 → still left
    await expect(
      service.purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        usedMakes: MAX_VOICE_MAKES_PER_REQUEST, // 3, below limit of 8
      })
    ).rejects.toBeInstanceOf(VoiceMakesStillLeftError);
    // Also verify the limit is computed correctly
    expect(voiceMakeLimitForPurchasedMakes(makesForTopUpAmount(49))).toBe(
      MAX_VOICE_MAKES_PER_REQUEST + 5
    );
  });

  it("keeps +5 makes for a legacy 29-credit pack", async () => {
    const { db } = fakeDb({ balance: 500, packRows: [{ amount_charged: 29 }] });
    const service = new VoiceMakeTopUpService(db as never);
    await expect(
      service.purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        usedMakes: MAX_VOICE_MAKES_PER_REQUEST,
      })
    ).rejects.toBeInstanceOf(VoiceMakesStillLeftError);
    expect(voiceMakeLimitForPurchasedMakes(makesForTopUpAmount(29))).toBe(
      MAX_VOICE_MAKES_PER_REQUEST + 5
    );
  });

  it("sums makes correctly for mixed old (49cr) and new (12cr) packs", async () => {
    // One old pack (49cr → +5) + one new pack (12cr → +2) = +7 purchased makes
    const { db } = fakeDb({
      balance: 500,
      packRows: [
        { amount_charged: 49 },
        { amount_charged: VOICE_MAKE_TOP_UP.priceCredits },
      ],
    });
    const service = new VoiceMakeTopUpService(db as never);
    const purchased = await service.purchasedMakes(REQUEST_ID);
    expect(purchased).toBe(5 + VOICE_MAKE_TOP_UP.makes); // 5 + 2 = 7
    expect(voiceMakeLimitForPurchasedMakes(purchased)).toBe(
      MAX_VOICE_MAKES_PER_REQUEST + 7
    );
  });

  it("prices the pack above the typical server cost for two makes", () => {
    // 2 makes of a 40 s voice ≈ ฿6.6 typical, ≈ ฿14 worst case (see requestLimits.ts).
    // 12 credits is above typical (> 6) and below worst case (< 15).
    expect(VOICE_MAKE_TOP_UP.priceCredits).toBeGreaterThan(6);
    expect(VOICE_MAKE_TOP_UP.priceCredits).toBeLessThan(15);
  });
});
