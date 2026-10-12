/**
 * Who may take a video OUT of the app, and until when (Tho, 2026-10-12).
 *
 *   * a free request's videos stay in the app until a package is bought;
 *   * buying unlocks every free request that has not expired and gives each
 *     a fresh 30 days from the purchase;
 *   * every video is gone 30 days after its first delivery;
 *   * download keeps working after a package ends (until expiry), but sending
 *     to Channel Management needs a package that is live now.
 */

import { MockClipRequestRepository } from "@/repositories/mock/MockClipRequestRepository";
import { VideoAccessService, describeAccess } from "@/services/VideoAccessService";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import { Platform } from "@/domain/enums/Platform";
import { VIDEO_LIFETIME_DAYS } from "@/config/retention";
import type { ClipRequest } from "@/domain/models/ClipRequest";

const DAY = 86_400_000;
const USER = "user-access-1";

const FORM = {
  title: "Access Test Clip",
  placeName: "Pho 54",
  latitude: 13.7563,
  longitude: 100.5018,
  description: "A description that is definitely long enough to pass validation.",
  targetAudience: "People who like testing software",
  targetPlatforms: [Platform.TikTok] as [Platform, ...Platform[]],
  preferredStyle: "Dynamic",
  preferredLanguage: "English",
  durationSeconds: 15,
};

function setup(
  opts: { passExpiresAt?: Date | null; windowExpiresAt?: Date | null; purchasedAt?: Date } = {}
) {
  const requests = new MockClipRequestRepository(new Map());
  const purchasedAt = opts.purchasedAt ?? new Date();
  const passes = {
    findEffectiveExpiry: jest.fn(async () =>
      opts.passExpiresAt
        ? { passId: "pass-1", startsAt: new Date(0), expiresAt: opts.passExpiresAt }
        : null
    ),
    findByUserId: jest.fn(async () =>
      opts.passExpiresAt
        ? [{ status: "active", revokedAt: null, createdAt: purchasedAt }]
        : []
    ),
  };
  const windows = {
    latestExpiry: jest.fn(async () => opts.windowExpiresAt ?? null),
    findByUserId: jest.fn(async () =>
      opts.windowExpiresAt ? [{ status: "active", createdAt: purchasedAt }] : []
    ),
  };
  const service = new VideoAccessService(requests, passes as never, windows as never);
  return { requests, service };
}

/** A submitted request, optionally delivered (which stamps its 30 days). */
async function request(
  repo: MockClipRequestRepository,
  opts: {
    unlocked: boolean;
    delivered?: boolean;
    expiresAt?: Date | null;
    userId?: string;
    submittedAt?: Date;
  }
): Promise<ClipRequest> {
  const draft = await repo.create({ userId: opts.userId ?? USER, ...FORM });
  await repo.updateStatus(draft.id, RequestStatus.Submitted, {
    submittedAt: opts.submittedAt ?? new Date(Date.now() - 60_000),
    pricingTier: opts.unlocked ? RequestPricingTier.Paid : RequestPricingTier.Free,
    downloadUnlocked: opts.unlocked,
  });
  if (opts.delivered) {
    await repo.updateStatus(
      draft.id,
      RequestStatus.Delivered,
      opts.expiresAt !== undefined ? { videosExpireAt: opts.expiresAt } : undefined
    );
  }
  return (await repo.findById(draft.id)) as ClipRequest;
}

describe("describeAccess — the decision", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const base = { id: "r", userId: USER, status: RequestStatus.Delivered } as ClipRequest;
  const later = new Date(now.getTime() + 10 * DAY);
  const earlier = new Date(now.getTime() - DAY);

  it("a free video stays in the app: no download, no transfer", () => {
    const access = describeAccess({ ...base, downloadUnlocked: false, videosExpireAt: later }, false, now);
    expect(access.canDownload).toBe(false);
    expect(access.canSendToManagement).toBe(false);
    expect(access.downloadBlock).toBe("package_required");
    expect(access.transferBlock).toBe("package_required");
    expect(access.expiresAt).toEqual(later);
  });

  it("a paid video downloads and transfers while the package is live", () => {
    const access = describeAccess({ ...base, downloadUnlocked: true, videosExpireAt: later }, true, now);
    expect(access.canDownload).toBe(true);
    expect(access.canSendToManagement).toBe(true);
  });

  it("after the package ends a paid video still downloads, but no longer transfers", () => {
    const access = describeAccess({ ...base, downloadUnlocked: true, videosExpireAt: later }, false, now);
    expect(access.canDownload).toBe(true);
    expect(access.canSendToManagement).toBe(false);
    expect(access.transferBlock).toBe("package_required");
  });

  it("an expired video is gone, package or not", () => {
    const access = describeAccess({ ...base, downloadUnlocked: true, videosExpireAt: earlier }, true, now);
    expect(access.expired).toBe(true);
    expect(access.downloadBlock).toBe("expired");
    expect(access.transferBlock).toBe("expired");
  });
});

describe("hasActivePackage", () => {
  it("is true for a live pass or a live video window, false otherwise", async () => {
    const future = new Date(Date.now() + DAY);
    const past = new Date(Date.now() - DAY);
    expect(await setup({ passExpiresAt: future }).service.hasActivePackage(USER)).toBe(true);
    expect(await setup({ windowExpiresAt: future }).service.hasActivePackage(USER)).toBe(true);
    expect(await setup({ passExpiresAt: past }).service.hasActivePackage(USER)).toBe(false);
    expect(await setup().service.hasActivePackage(USER)).toBe(false);
  });
});

describe("unlockForPackage — what a purchase does", () => {
  it("unlocks a delivered free video and gives it a fresh 30 days from the purchase", async () => {
    const { requests, service } = setup();
    const free = await request(requests, {
      unlocked: false,
      delivered: true,
      expiresAt: new Date(Date.now() + 2 * DAY),
    });

    const purchasedAt = new Date();
    expect(await service.unlockForPackage(USER, purchasedAt)).toBe(1);

    const after = (await requests.findById(free.id)) as ClipRequest;
    expect(after.downloadUnlocked).toBe(true);
    expect(after.videosExpireAt?.getTime()).toBe(purchasedAt.getTime() + VIDEO_LIFETIME_DAYS * DAY);
  });

  it("unlocks a free request still in production without dating it — delivery starts its 30 days", async () => {
    const { requests, service } = setup();
    const inProduction = await request(requests, { unlocked: false });
    await service.unlockForPackage(USER);
    const after = (await requests.findById(inProduction.id)) as ClipRequest;
    expect(after.downloadUnlocked).toBe(true);
    expect(after.videosExpireAt ?? null).toBeNull();

    const delivered = await requests.updateStatus(inProduction.id, RequestStatus.Delivered);
    expect(delivered.videosExpireAt).toBeInstanceOf(Date);
  });

  it("does not revive an expired free video", async () => {
    const { requests, service } = setup();
    const gone = await request(requests, {
      unlocked: false,
      delivered: true,
      expiresAt: new Date(Date.now() - DAY),
    });
    expect(await service.unlockForPackage(USER)).toBe(0);
    expect((await requests.findById(gone.id))?.downloadUnlocked).toBe(false);
  });

  it("leaves paid videos' dates alone and ignores drafts and other accounts", async () => {
    const { requests, service } = setup();
    const paidExpiry = new Date(Date.now() + 5 * DAY);
    const paid = await request(requests, { unlocked: true, delivered: true, expiresAt: paidExpiry });
    const draft = await requests.create({ userId: USER, ...FORM });
    const theirs = await request(requests, { unlocked: false, userId: "someone-else" });

    expect(await service.unlockForPackage(USER)).toBe(0);
    expect((await requests.findById(paid.id))?.videosExpireAt).toEqual(paidExpiry);
    expect((await requests.findById(draft.id))?.downloadUnlocked).toBe(false);
    expect((await requests.findById(theirs.id))?.downloadUnlocked).toBe(false);
  });

  it("is idempotent: a second call changes nothing", async () => {
    const { requests, service } = setup();
    const free = await request(requests, {
      unlocked: false,
      delivered: true,
      expiresAt: new Date(Date.now() + DAY),
    });
    await service.unlockForPackage(USER, new Date());
    const first = (await requests.findById(free.id))?.videosExpireAt;
    expect(await service.unlockForPackage(USER, new Date(Date.now() + 5 * DAY))).toBe(0);
    expect((await requests.findById(free.id))?.videosExpireAt).toEqual(first);
  });
});

describe("a free request made while the package's month was used up", () => {
  it("stays locked although the account holds a live package", async () => {
    const purchasedAt = new Date(Date.now() - 10 * DAY);
    const { requests, service } = setup({
      passExpiresAt: new Date(Date.now() + 20 * DAY),
      purchasedAt,
    });
    const madeAfter = await request(requests, {
      unlocked: false,
      delivered: true,
      submittedAt: new Date(Date.now() - DAY),
    });

    const access = await service.accessFor(madeAfter);
    expect(access.unlocked).toBe(false);
    expect(access.downloadBlock).toBe("package_required");
    expect(access.transferBlock).toBe("package_required");
    expect(await service.unlockForPackage(USER, new Date(), purchasedAt)).toBe(0);
  });

  it("is unlocked by the NEXT purchase", async () => {
    const { requests, service } = setup();
    const madeAfter = await request(requests, {
      unlocked: false,
      delivered: true,
      submittedAt: new Date(Date.now() - DAY),
    });
    expect(await service.unlockForPackage(USER, new Date())).toBe(1);
    expect((await requests.findById(madeAfter.id))?.downloadUnlocked).toBe(true);
  });
});

describe("accessFor — the safety net behind the purchase hook", () => {
  it("unlocks a free video on sight once the account holds a package", async () => {
    const { requests, service } = setup({ passExpiresAt: new Date(Date.now() + 30 * DAY) });
    const free = await request(requests, {
      unlocked: false,
      delivered: true,
      expiresAt: new Date(Date.now() + DAY),
    });

    const access = await service.accessFor(free);
    expect(access.unlocked).toBe(true);
    expect(access.canDownload).toBe(true);
    expect(access.canSendToManagement).toBe(true);
    // The fresh 30 days, not the old one-day-left date.
    expect(access.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("leaves a free video locked when there is no package", async () => {
    const { requests, service } = setup();
    const free = await request(requests, { unlocked: false, delivered: true });
    const access = await service.accessFor(free);
    expect(access.unlocked).toBe(false);
    expect(access.downloadBlock).toBe("package_required");
    expect((await requests.findById(free.id))?.downloadUnlocked).toBe(false);
  });
});
