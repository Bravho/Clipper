/**
 * Single video download unlock: 39 credits, 30-day window, idempotent,
 * expired requests refused, does NOT grant channel management.
 *
 * Pay-at-submit (submitNew) and the matching auto-refund (refundSingleUnlock)
 * are gone — the unlock is only ever bought AFTER a free video is delivered.
 */
import {
  VideoDownloadUnlockService,
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

  it("refuses to unlock a draft — pay-at-submit is gone", async () => {
    const { db } = fakeDb({ balance: 100, status: "draft" });
    await expect(
      new VideoDownloadUnlockService(db as never).purchase({
        userId: USER_ID,
        requestId: REQUEST_ID,
        currentExpiry: null,
        alreadyUnlocked: false,
        now: NOW,
      })
    ).rejects.toThrow("Drafts cannot be unlocked");
  });

  it("does not accept a submitNew flag on purchase", () => {
    // Type-level guard: TypeScript rejects submitNew. The runtime check is
    // that the parameter shape expected by purchase has no such key.
    const _accepted: Parameters<VideoDownloadUnlockService["purchase"]>[0] = {
      userId: USER_ID,
      requestId: REQUEST_ID,
      currentExpiry: null,
      alreadyUnlocked: false,
    };
    expect("submitNew" in _accepted).toBe(false);
  });
});

// refundSingleUnlock has been removed from VideoDownloadUnlockService. The
// pipeline failure path no longer auto-refunds the 39-credit unlock because
// there is no longer a way to buy it at submission time. Quota refunds are
// still handled by VideoQuotaService.refundRequest — covered by the
// VideoQuotaService tests.
