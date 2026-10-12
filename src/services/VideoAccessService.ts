/**
 * VideoAccessService — may a requester take a request's videos OUT of the app?
 *
 * THE RULE (Tho, 2026-10-12):
 *
 *   * A free request's videos can be made and watched in the app, but NOT
 *     downloaded and NOT sent to Channel Management.
 *   * Buying a package unlocks every free request that has not expired, and
 *     gives each of them a fresh VIDEO_LIFETIME_DAYS (30) from the purchase.
 *   * A request a package paid for is unlocked from submission. A request made
 *     on the free allowance stays locked EVEN IF the account holds a package
 *     whose month has run out (Tho, 2026-10-12): only a purchase made AFTER
 *     the request unlocks it.
 *   * A package video is kept VIDEO_LIFETIME_DAYS (30) from its first delivery;
 *     a free one only FREE_VIDEO_LIFETIME_DAYS (14) — buying within that time
 *     unlocks it and gives it 30 days from the purchase. After its date a video
 *     is gone — no download, no transfer — and the user sees the date on every
 *     video.
 *   * Download keeps working after the package ends, until the video expires.
 *     Sending to Channel Management needs a package that is live NOW, since
 *     nothing can be published from there without one.
 *
 * WHAT COUNTS AS A PACKAGE. A live Channel Management access pass (every
 * package on sale since 2026-09-27 grants one) or a live video allowance window
 * (the retired video-only packages, honoured until they run out). Upload-token
 * bundles (`management_single_video`) do NOT count.
 *
 * Every route that hands a video out — download, transfer, upload — asks this
 * service, so the rule lives in one place. The UI only receives the result.
 */

import { VIDEO_LIFETIME_DAYS, addDays } from "@/config/retention";
import type { ClipRequest } from "@/domain/models/ClipRequest";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ManagementAccessPassStatus } from "@/domain/enums/ManagementStatus";
import { VideoAllowanceWindowStatus } from "@/domain/enums/VideoAllowanceStatus";
import type { IClipRequestRepository } from "@/repositories/interfaces/IClipRequestRepository";
import type { IManagementAccessPassRepository } from "@/repositories/interfaces/IManagementRepositories";
import type { IVideoAllowanceWindowRepository } from "@/repositories/interfaces/IVideoAllowanceWindowRepository";
import {
  clipRequestRepository,
  managementAccessPassRepository,
  videoAllowanceWindowRepository,
} from "@/repositories";

/** Why a video cannot leave the app right now. */
export type VideoAccessBlock =
  /** A free request and no package: buy one to unlock it. */
  | "package_required"
  /** Past its expiry date: the video is gone. */
  | "expired";

export interface VideoAccess {
  /** The request may leave the app (paid for, or unlocked by a purchase). */
  unlocked: boolean;
  /** The account holds a live package right now. */
  hasPackage: boolean;
  /** When the videos expire; null until the request is first delivered. */
  expiresAt: Date | null;
  expired: boolean;
  /** Download allowed now. */
  canDownload: boolean;
  /** "Send to Channel Management" allowed now. */
  canSendToManagement: boolean;
  /** Why download is refused, or null when it is allowed. */
  downloadBlock: VideoAccessBlock | null;
  /** Why the transfer is refused, or null when it is allowed. */
  transferBlock: VideoAccessBlock | null;
}

/** The JSON shape the studio and the request page receive. */
export interface VideoAccessView {
  unlocked: boolean;
  hasPackage: boolean;
  expiresAt: string | null;
  expired: boolean;
  canDownload: boolean;
  canSendToManagement: boolean;
  downloadBlock: VideoAccessBlock | null;
  transferBlock: VideoAccessBlock | null;
}

export function toVideoAccessView(access: VideoAccess): VideoAccessView {
  return { ...access, expiresAt: access.expiresAt ? access.expiresAt.toISOString() : null };
}

/** Statuses a free request can be in and still be worth unlocking. */
const DEAD_STATUSES: ReadonlySet<RequestStatus> = new Set([
  RequestStatus.Draft,
  RequestStatus.Rejected,
  RequestStatus.AutoCancelled,
]);

export class VideoAccessService {
  constructor(
    private requests: Pick<
      IClipRequestRepository,
      "findById" | "findByUserId" | "updateStatus"
    > = clipRequestRepository,
    private passes: Pick<
      IManagementAccessPassRepository,
      "findEffectiveExpiry" | "findByUserId"
    > = managementAccessPassRepository,
    private windows: Pick<
      IVideoAllowanceWindowRepository,
      "latestExpiry" | "findByUserId"
    > = videoAllowanceWindowRepository
  ) {}

  /**
   * When the account last bought a package (a pass or a video window), or
   * null. Pending and revoked rows do not count.
   */
  async latestPurchaseAt(userId: string): Promise<Date | null> {
    const [passes, windows] = await Promise.all([
      this.passes.findByUserId(userId),
      this.windows.findByUserId(userId),
    ]);
    const times = [
      ...passes
        .filter(
          (p) =>
            !p.revokedAt &&
            (p.status === ManagementAccessPassStatus.Active ||
              p.status === ManagementAccessPassStatus.Expired)
        )
        .map((p) => p.createdAt.getTime()),
      ...windows
        .filter(
          (w) =>
            w.status === VideoAllowanceWindowStatus.Active ||
            w.status === VideoAllowanceWindowStatus.Expired
        )
        .map((w) => w.createdAt.getTime()),
    ];
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  }

  /** Does the account hold a live package right now? */
  async hasActivePackage(userId: string, now: Date = new Date()): Promise<boolean> {
    const pass = await this.passes.findEffectiveExpiry(userId);
    if (pass && pass.expiresAt.getTime() > now.getTime()) return true;
    const window = await this.windows.latestExpiry(userId, now);
    return Boolean(window && window.getTime() > now.getTime());
  }

  /**
   * Unlock the account's free requests made BEFORE a package purchase, and
   * start each one's 30 days again from that purchase. Call right after a
   * purchase (`purchasedAt` defaults to `now`).
   *
   * A free request submitted AFTER the purchase is left locked: it was made on
   * the free allowance because the package's month was already used up, and
   * only the next purchase unlocks it (Tho, 2026-10-12).
   *
   * A request not yet delivered is unlocked but keeps no date — its 30 days
   * start at delivery like any other. Expired requests are not revived.
   * Idempotent: an unlocked request is never touched again.
   *
   * Returns how many requests were unlocked.
   */
  async unlockForPackage(
    userId: string,
    now: Date = new Date(),
    purchasedAt: Date = now
  ): Promise<number> {
    const all = await this.requests.findByUserId(userId);
    const freshExpiry = addDays(purchasedAt, VIDEO_LIFETIME_DAYS);
    let unlocked = 0;
    for (const request of all) {
      if (request.downloadUnlocked) continue;
      if (DEAD_STATUSES.has(request.status)) continue;
      if (isExpired(request, now)) continue;
      // Made after this purchase: the package was already used up for it.
      if (request.submittedAt && request.submittedAt.getTime() > purchasedAt.getTime()) continue;
      await this.requests.updateStatus(request.id, request.status, {
        downloadUnlocked: true,
        // Explicit null keeps an undelivered request undated; the delivery
        // stamp sets it later. (undefined would let a Delivered status stamp
        // the ORIGINAL delivery-based date instead of the purchase-based one.)
        videosExpireAt: request.videosExpireAt ? freshExpiry : null,
      });
      unlocked += 1;
    }
    return unlocked;
  }

  /**
   * What the requester may do with this request's videos right now.
   *
   * Also the safety net for the purchase hook: a locked request made BEFORE
   * the account's latest purchase is unlocked here (dated from that purchase),
   * so a purchase whose hook failed is still honoured on the next look. A
   * locked request made after the latest purchase stays locked.
   */
  async accessFor(request: ClipRequest, now: Date = new Date()): Promise<VideoAccess> {
    const hasPackage = await this.hasActivePackage(request.userId, now);
    let current = request;
    if (!current.downloadUnlocked && hasPackage && !isExpired(current, now)) {
      const purchasedAt = await this.latestPurchaseAt(current.userId);
      const madeBefore =
        purchasedAt != null &&
        (!current.submittedAt || current.submittedAt.getTime() <= purchasedAt.getTime());
      if (purchasedAt && madeBefore) {
        await this.unlockForPackage(current.userId, now, purchasedAt);
        current = (await this.requests.findById(current.id)) ?? current;
      }
    }
    return describeAccess(current, hasPackage, now);
  }
}

function isExpired(request: ClipRequest, now: Date): boolean {
  return Boolean(request.videosExpireAt && request.videosExpireAt.getTime() <= now.getTime());
}

/** The decision itself, without any I/O — exported for tests and callers that already know `hasPackage`. */
export function describeAccess(
  request: ClipRequest,
  hasPackage: boolean,
  now: Date = new Date()
): VideoAccess {
  const unlocked = Boolean(request.downloadUnlocked);
  const expired = isExpired(request, now);
  const downloadBlock: VideoAccessBlock | null = expired
    ? "expired"
    : unlocked
      ? null
      : "package_required";
  const transferBlock: VideoAccessBlock | null = expired
    ? "expired"
    : unlocked && hasPackage
      ? null
      : "package_required";
  return {
    unlocked,
    hasPackage,
    expiresAt: request.videosExpireAt ?? null,
    expired,
    canDownload: downloadBlock === null,
    canSendToManagement: transferBlock === null,
    downloadBlock,
    transferBlock,
  };
}

export const videoAccessService = new VideoAccessService();
