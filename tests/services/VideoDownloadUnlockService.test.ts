/**
 * Single video download unlock: 39 credits, 30-day window, idempotent,
 * expired requests refused, does NOT grant channel management.
 * Also covers refundSingleUnlock: returns the unlock credit on render failure,
 * idempotent, skips free / package / delivered requests.
 */
import {
  VideoDownloadUnlockService,
  VideoAlreadyUnlockedError,
  VideoUnlockInsufficientCreditsError,
  VideoUnlockExpiredError,
} from "@/services/VideoDownloadUnlockService";
import { VIDEO_DOWNLOAD_UNLOCK } from "@/config/requestLimits";
import { describeAccess } from "@/services/VideoAccessService";

const REQUEST_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "user-unlock-1";
const NOW = new Date("2026-10-27T10:00:00Z");
const PRICE = VIDEO_DOWNLOAD_UNLOCK.priceCredits; // 39
const DAYS = VIDEO_DOWNLOAD_UNLOCK.days;           // 30

function fakeDb(state: {
  balance: number;
  existingUnlocks?: number;
  walletMissing?: boolean;
  status?: string;
  unlocked?: boolean;
  tier?: string;
  expiry?: Date | null;
  missingRequest?: boolean;
}) {
  const statements: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const text = sql.replace(/\s+/g, " ").trim();
      statements.push(text.split(" ").slice(0, 3).join(" "));
      if (text.startsWith("SELECT status, pricing_tier")) {
        return { rows: state.missingRequest ? [] : [{ status: state.status ?? "delivered", pricing_tier: state.tier ?? "free", download_unlocked: state.unlocked ?? false, videos_expire_at: state.expiry ?? null }] };
      }
      if (text.startsWith("SELECT id, balance FROM credit_wallets")) {
        return { rows: state.walletMissing ? [] : [{ id: "w1", balance: state.balance }] };
      }
      if (text.includes("COUNT(*)") && text.includes("video_download_unlock")) {
        return { rows: [{ n: state.existingUnlocks ?? 0 }] };
      }
      if (text.startsWith("UPDATE credit_wallets")) {
        const price = Number(params?.[0]);
        if (state.balance < price) return { rows: [] };
        state.balance -= price;
        return { rows: [{ balance: state.balance }] };
      }
      if (text.startsWith("INSERT INTO credit_transactions")) {
        state.existingUnlocks = (state.existingUnlocks ?? 0) + 1;
        return { rows: [] };
      }
      if (text.startsWith("UPDATE clip_requests")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  const db = { connect: jest.fn(async () => client), query: jest.fn(async () => ({ rows: [] })) };
  return { db, client, statements, state };
}

describe("VideoDownloadUnlockService", () => {
  it("unlocks and debits the wallet once, within one transaction", async () => {
    const { db, state } = fakeDb({ balance: 100 });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      currentExpiry: null,
      alreadyUnlocked: false,
      now: NOW,
    });
    expect(result.charged).toBe(true);
    expect(result.creditsSpent).toBe(PRICE);
    expect(result.balanceCredits).toBe(100 - PRICE);
    expect(state.balance).toBe(100 - PRICE);
    // Unlocked for 30 days from now
    expect(result.unlockedUntil?.getTime()).toBe(new Date("2026-11-26T10:00:00Z").getTime());
  });

  it("is idempotent: second call returns charged=false without debiting", async () => {
    const { db, state } = fakeDb({ balance: 100, existingUnlocks: 1 });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      currentExpiry: null,
      alreadyUnlocked: false,
      now: NOW,
    });
    expect(result.charged).toBe(false);
    expect(result.creditsSpent).toBe(0);
    expect(state.balance).toBe(100); // untouched
  });

  it("is idempotent when alreadyUnlocked=true (package or prior unlock)", async () => {
    const { db } = fakeDb({ balance: 100, unlocked: true, tier: "paid" });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      currentExpiry: new Date(NOW.getTime() + 10 * 86_400_000),
      alreadyUnlocked: true,
      now: NOW,
    });
    expect(result.charged).toBe(false);
    expect(result.creditsSpent).toBe(0);
    expect(result.balanceCredits).toBe(100);
  });

  it("refuses an expired request before touching the DB", async () => {
    const { db } = fakeDb({ balance: 100 });
    const service = new VideoDownloadUnlockService(db as never);
    const expiredAt = new Date(NOW.getTime() - 1000);
    await expect(
      service.purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        currentExpiry: expiredAt,
        alreadyUnlocked: false,
        now: NOW,
      })
    ).rejects.toBeInstanceOf(VideoUnlockExpiredError);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("refuses when the wallet has insufficient credits", async () => {
    const { db, client } = fakeDb({ balance: PRICE - 1 });
    const service = new VideoDownloadUnlockService(db as never);
    await expect(
      service.purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        currentExpiry: null,
        alreadyUnlocked: false,
        now: NOW,
      })
    ).rejects.toBeInstanceOf(VideoUnlockInsufficientCreditsError);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("does NOT count as a live package in VideoAccessService", () => {
    // The single unlock sets downloadUnlocked=true but no access pass or
    // video window — hasPackage stays false, so CM is not available.
    const unlockedRequest = {
      id: REQUEST_ID,
      userId: USER_ID,
      downloadUnlocked: true,
      videosExpireAt: new Date(NOW.getTime() + DAYS * 86_400_000),
      status: "delivered" as never,
      submittedAt: NOW,
    } as never;
    const access = describeAccess(unlockedRequest, /* hasPackage */ false, NOW);
    expect(access.unlocked).toBe(true);
    expect(access.canDownload).toBe(true);
    expect(access.hasPackage).toBe(false);
    expect(access.canSendToManagement).toBe(false);
    expect(access.transferBlock).toBe("package_required");
  });

  it("gives exactly 30 days from the purchase date", async () => {
    const { db } = fakeDb({ balance: 200 });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.purchase({
      userId: USER_ID,
      requestId: REQUEST_ID,
      currentExpiry: null,
      alreadyUnlocked: false,
      now: NOW,
    });
    const expectedMs = NOW.getTime() + 30 * 86_400_000;
    expect(result.unlockedUntil?.getTime()).toBe(expectedMs);
  });

  it("debits only once across repeated actual purchases", async () => {
    const { db, state } = fakeDb({ balance: 100 });
    const service = new VideoDownloadUnlockService(db as never);
    const input = { userId: USER_ID, requestId: REQUEST_ID, currentExpiry: null, alreadyUnlocked: false, now: NOW };
    expect((await service.purchase(input)).charged).toBe(true);
    expect((await service.purchase(input)).charged).toBe(false);
    expect(state.balance).toBe(61);
  });

  it.each(["auto_cancelled", "rejected"])("refuses deleted status %s even without expiry", async (status) => {
    const { db, client } = fakeDb({ balance: 100, status });
    await expect(new VideoDownloadUnlockService(db as never).purchase({ userId: USER_ID, requestId: REQUEST_ID, currentExpiry: null, alreadyUnlocked: true, now: NOW })).rejects.toBeInstanceOf(VideoUnlockExpiredError);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("checks ownership again under the request lock", async () => {
    const { db } = fakeDb({ balance: 100, missingRequest: true });
    await expect(new VideoDownloadUnlockService(db as never).purchase({ userId: USER_ID, requestId: REQUEST_ID, currentExpiry: null, alreadyUnlocked: false, now: NOW })).rejects.toThrow("Request not found");
  });

  it("refuses an expiry discovered under the lock even with a stale caller snapshot", async () => {
    const { db } = fakeDb({ balance: 100, expiry: new Date(NOW.getTime() - 1) });
    await expect(new VideoDownloadUnlockService(db as never).purchase({ userId: USER_ID, requestId: REQUEST_ID, currentExpiry: null, alreadyUnlocked: false, now: NOW })).rejects.toBeInstanceOf(VideoUnlockExpiredError);
  });

  it("does not sell an unlock to a non-free locked request", async () => {
    const { db } = fakeDb({ balance: 100, tier: "paid" });
    await expect(new VideoDownloadUnlockService(db as never).purchase({ userId: USER_ID, requestId: REQUEST_ID, currentExpiry: null, alreadyUnlocked: false, now: NOW })).rejects.toThrow("Only free requests");
  });

  it("submits a standalone paid draft with no free or package quota and dates it at delivery", async () => {
    const { db, client } = fakeDb({ balance: 100, status: "draft" });
    const result = await new VideoDownloadUnlockService(db as never).purchase({ userId: USER_ID, requestId: REQUEST_ID, currentExpiry: null, alreadyUnlocked: false, submitNew: true, now: NOW });
    expect(result).toMatchObject({ charged: true, balanceCredits: 61, unlockedUntil: null });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("pricing_tier = 'paid'"), [NOW, REQUEST_ID]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("videos_expire_at  = $1"), [null, REQUEST_ID]);
    expect(client.query.mock.calls.some(([sql]) => sql.includes("video_allowance_windows"))).toBe(false);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });
});

// ── refundSingleUnlock ──────────────────────────────────────────────────────

function fakeRefundDb(state: {
  chargeAmount?: number;   // amount_charged from the video_download_unlock row; undefined = no row
  userId?: string;
  allowanceWindowId?: string | null; // null = single-unlock (refundable), string = package
  requestStatus?: string;
  pricingTier?: string; // 'paid' = new single-unlock request; 'free' = existing video unlocked later
  balance?: number;
  existingRefund?: boolean;
  walletMissing?: boolean;
}) {
  const CHARGE_AMOUNT = state.chargeAmount ?? PRICE;
  const USER = state.userId ?? USER_ID;
  const statements: string[] = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      const text = sql.replace(/\s+/g, " ").trim();
      statements.push(text.split(" ").slice(0, 4).join(" "));

      if (text.startsWith("SELECT user_id, ABS(amount)")) {
        // GET_UNLOCK_CHARGE_SQL via client (inside transaction)
        return state.chargeAmount !== undefined
          ? { rows: [{ user_id: USER, amount_charged: CHARGE_AMOUNT }] }
          : { rows: [] };
      }
      if (text.includes("video_allowance_window_id")) {
        return {
          rows: [{
            video_allowance_window_id: state.allowanceWindowId ?? null,
            status: state.requestStatus ?? "failed",
            pricing_tier: state.pricingTier ?? "paid",
          }],
        };
      }
      if (text.startsWith("SELECT id, balance FROM credit_wallets")) {
        return state.walletMissing ? { rows: [] } : { rows: [{ id: "w1", balance: state.balance ?? 100 }] };
      }
      if (text.includes("request_refund") && text.includes("COUNT(*)")) {
        return { rows: [{ n: state.existingRefund ? 1 : 0 }] };
      }
      if (text.startsWith("INSERT INTO credit_transactions")) {
        state.existingRefund = true;
        return { rows: [] };
      }
      if (text.startsWith("UPDATE credit_wallets")) {
        const amt = Number(params?.[0]);
        state.balance = (state.balance ?? 100) + amt;
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  // db.query handles the initial pre-check (GET_UNLOCK_CHARGE_SQL outside transaction)
  const db = {
    connect: jest.fn(async () => client),
    query: jest.fn(async (sql: string) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT user_id, ABS(amount)")) {
        return state.chargeAmount !== undefined
          ? { rows: [{ user_id: USER, amount_charged: CHARGE_AMOUNT }] }
          : { rows: [] };
      }
      return { rows: [] };
    }),
  };
  return { db, client, statements, state };
}

describe("VideoDownloadUnlockService.refundSingleUnlock", () => {
  it("issues a request_refund for the charged amount when a single-unlock request fails", async () => {
    const { db, client, state } = fakeRefundDb({ chargeAmount: PRICE, balance: 50 });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.refundSingleUnlock(REQUEST_ID);
    expect(result).toBe(true);
    expect(state.balance).toBe(50 + PRICE);
    // One INSERT for the refund row
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO credit_transactions"),
      expect.arrayContaining([USER_ID, PRICE, expect.stringContaining("Refund: single video unlock"), REQUEST_ID])
    );
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("is idempotent: a second call does not issue a second refund", async () => {
    const { db, state } = fakeRefundDb({ chargeAmount: PRICE, balance: 50 });
    const service = new VideoDownloadUnlockService(db as never);
    await service.refundSingleUnlock(REQUEST_ID);
    const initialBalance = state.balance;
    const result2 = await service.refundSingleUnlock(REQUEST_ID);
    // Second call sees existingRefund = true → returns false, balance unchanged
    expect(result2).toBe(false);
    expect(state.balance).toBe(initialBalance);
  });

  it("returns false (no refund) when there is no video_download_unlock charge", async () => {
    const { db } = fakeRefundDb({ chargeAmount: undefined });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.refundSingleUnlock(REQUEST_ID);
    expect(result).toBe(false);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("does not refund a package request (allowance window present)", async () => {
    const { db, client } = fakeRefundDb({ chargeAmount: PRICE, allowanceWindowId: "win-1" });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.refundSingleUnlock(REQUEST_ID);
    expect(result).toBe(false);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("does not refund an existing free video that was unlocked later (pricing_tier free)", async () => {
    const { db, client, state } = fakeRefundDb({ chargeAmount: PRICE, pricingTier: "free", balance: 50 });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.refundSingleUnlock(REQUEST_ID);
    expect(result).toBe(false);
    expect(state.balance).toBe(50);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("does not refund a delivered request", async () => {
    const { db, client } = fakeRefundDb({ chargeAmount: PRICE, requestStatus: "delivered" });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.refundSingleUnlock(REQUEST_ID);
    expect(result).toBe(false);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("does not refund when the wallet is missing", async () => {
    const { db, client } = fakeRefundDb({ chargeAmount: PRICE, walletMissing: true });
    const service = new VideoDownloadUnlockService(db as never);
    const result = await service.refundSingleUnlock(REQUEST_ID);
    expect(result).toBe(false);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("calls refundSingleUnlock from _refundAllowance on VideoGenerationService (failure handler path)", async () => {
    // Verify the failure handler triggers the refund: call _refundAllowance via
    // jest.mock and confirm refundSingleUnlock is invoked. Uses module mock so
    // the dynamic import inside _refundAllowance resolves to the spy.
    const refundSpy = jest.fn().mockResolvedValue(true);
    jest.doMock("@/services/VideoDownloadUnlockService", () => ({
      videoDownloadUnlockService: { refundSingleUnlock: refundSpy },
    }));
    jest.doMock("@/services/VideoQuotaService", () => ({
      videoQuotaService: { refundRequest: jest.fn().mockResolvedValue(true) },
    }));

    // Re-import VideoGenerationService after the mock is set so the dynamic
    // import inside _refundAllowance picks up the spy.
    jest.resetModules();
    const { VideoGenerationService } = await import("@/services/VideoGenerationService");
    const service = new VideoGenerationService();
    await (service as never as { _refundAllowance(id: string): Promise<void> })
      ._refundAllowance(REQUEST_ID);
    expect(refundSpy).toHaveBeenCalledWith(REQUEST_ID);

    jest.unmock("@/services/VideoDownloadUnlockService");
    jest.unmock("@/services/VideoQuotaService");
  });
});
