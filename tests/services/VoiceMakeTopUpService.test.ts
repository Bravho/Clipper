/**
 * Buying more voice makes with credits: one pack, only when the makes are
 * used up, debit and ledger row in ONE transaction.
 *
 * Driven against a fake PoolClient that records every statement, the same way
 * BundlePurchase.test.ts guards the bundle purchase.
 */
import {
  VoiceMakeTopUpService,
  VoiceMakeTopUpCreditsError,
  VoiceMakesStillLeftError,
  voiceMakeLimitForPacks,
} from "@/services/VoiceMakeTopUpService";
import { MAX_VOICE_MAKES_PER_REQUEST, VOICE_MAKE_TOP_UP } from "@/config/requestLimits";

const REQUEST_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "user-1";

function fakeDb(state: { balance: number; packs: number; walletMissing?: boolean }) {
  const statements: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const text = sql.replace(/\s+/g, " ").trim();
      statements.push(text.split(" ").slice(0, 2).join(" "));
      if (text.startsWith("SELECT id, balance FROM credit_wallets")) {
        return { rows: state.walletMissing ? [] : [{ id: "w1", balance: state.balance }] };
      }
      if (text.startsWith("SELECT COUNT(*)")) return { rows: [{ packs: state.packs }] };
      if (text.startsWith("UPDATE credit_wallets")) {
        const price = Number(params?.[0]);
        if (state.balance < price) return { rows: [] };
        state.balance -= price;
        return { rows: [{ balance: state.balance }] };
      }
      if (text.startsWith("INSERT INTO credit_transactions")) {
        expect(params).toEqual([
          USER_ID,
          -VOICE_MAKE_TOP_UP.priceCredits,
          expect.any(String),
          REQUEST_ID,
        ]);
        state.packs += 1;
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const db = {
    connect: jest.fn(async () => client),
    query: jest.fn(async () => ({ rows: [{ packs: state.packs }] })),
  };
  return { db, client, statements, state };
}

describe("VoiceMakeTopUpService", () => {
  it("sells one pack when the makes are used up, inside one transaction", async () => {
    const { db, client, statements, state } = fakeDb({ balance: 100, packs: 0 });
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
    const { db, state } = fakeDb({ balance: 500, packs: 0 });
    const service = new VoiceMakeTopUpService(db as never);
    const used = MAX_VOICE_MAKES_PER_REQUEST;
    await service.purchase({ userId: USER_ID, requestId: REQUEST_ID, usedMakes: used });
    await expect(
      service.purchase({ userId: USER_ID, requestId: REQUEST_ID, usedMakes: used })
    ).rejects.toBeInstanceOf(VoiceMakesStillLeftError);
    expect(state.packs).toBe(1);
    expect(state.balance).toBe(500 - VOICE_MAKE_TOP_UP.priceCredits);
  });

  it("refuses without a charge when the wallet is short", async () => {
    const { db, client, state } = fakeDb({ balance: VOICE_MAKE_TOP_UP.priceCredits - 1, packs: 0 });
    const service = new VoiceMakeTopUpService(db as never);
    await expect(
      service.purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        usedMakes: MAX_VOICE_MAKES_PER_REQUEST,
      })
    ).rejects.toBeInstanceOf(VoiceMakeTopUpCreditsError);
    expect(state.packs).toBe(0);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("sells a second pack once the first pack's makes are used too", async () => {
    const { db, state } = fakeDb({ balance: 500, packs: 1 });
    const service = new VoiceMakeTopUpService(db as never);
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      usedMakes: voiceMakeLimitForPacks(1),
    });
    expect(result.limit).toBe(voiceMakeLimitForPacks(2));
    expect(state.packs).toBe(2);
  });

  it("prices the pack above what five makes cost the server", () => {
    // ≈ ฿40 worst case for 5 makes of the longest voice (see requestLimits.ts).
    expect(VOICE_MAKE_TOP_UP.priceCredits).toBeGreaterThan(40);
  });
});
