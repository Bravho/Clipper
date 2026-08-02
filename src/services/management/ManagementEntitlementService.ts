/**
 * ManagementEntitlementService — the single authority on whether a user may
 * PUBLISH from RClipper Management.
 *
 * WHERE THE GATE SITS. Getting content into Management is free: transferring a
 * finished generation project and uploading your own video both cost nothing.
 * Money is required immediately before a video is submitted to social channels
 * and nowhere else. `checkTransferEligibility` therefore answers only
 * "is this project ready and yours?", while `evaluateForPublish` is the paid
 * gate.
 *
 * THE FRONTEND IS NEVER THE AUTHORITY. The UI receives an already-evaluated
 * result purely so it can render the right panel; every mutating route calls
 * back into this service before acting.
 *
 * Nothing is cached on a user row. Entitlement is recomputed from the passes and
 * unlocks on every call, so a revocation, refund or expiry takes effect on the
 * very next request.
 *
 * EXPIRY SEMANTICS (deliberate): when access lapses the user keeps everything —
 * content, publication history and payment history all stay readable, and any
 * already-published social post is left alone. Only NEW publications are
 * blocked.
 *
 * TWO WAYS TO PUBLISH. An active access pass grants UNLIMITED publishing for its
 * window and consumes nothing. Without a pass, publishing spends UPLOAD TOKENS
 * from a consumable bundle — one token per video-to-one-channel (one publication
 * target). The pass is checked first, so a pass holder never spends a token.
 */

import {
  clipRequestRepository,
  managementAccessPassRepository,
  managementUploadBundleRepository,
  managementContentRepository,
  videoGenerationJobRepository,
} from "@/repositories";
import type {
  ManagementEntitlement,
  ManagementDenialReason,
  ManagementTransferEligibility,
} from "@/domain/models/ManagementEntitlement";
import { ManagementEntitlementType } from "@/domain/enums/ManagementStatus";
import { hasUsableMedia } from "@/domain/models/ManagementContent";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { VideoGenerationJob } from "@/domain/models/VideoGenerationJob";
import { isManagementEnabledFor } from "@/config/management";

/** A denial, expressed as an entitlement so callers have one shape to handle. */
function deny(reason: ManagementDenialReason): ManagementEntitlement {
  return { allowed: false, entitlementType: ManagementEntitlementType.None, reason };
}

/**
 * The generated exports eligible for transfer.
 *
 * These are the CAPTIONED exports — the videos actually delivered to the user —
 * falling back to the un-captioned master for a ratio only when the overlay step
 * never produced a captioned version. The Travy-specific export is deliberately
 * excluded because RClipper administrators manage that channel, not the requester.
 */
export function eligibleExportAssetIds(job: VideoGenerationJob): {
  variant: string;
  assetId: string;
  ratio: string | null;
}[] {
  const ratios = [
    {
      variant: "9:16",
      ratio: "9:16",
      captioned: job.captionedExport_9_16_assetId,
      master: job.finalExport_9_16_assetId,
    },
    {
      variant: "16:9",
      ratio: "16:9",
      captioned: job.captionedExport_16_9_assetId,
      master: job.finalExport_16_9_assetId,
    },
    {
      variant: "4:5",
      ratio: "4:5",
      captioned: job.captionedExport_4_5_assetId,
      master: job.finalExport_4_5_assetId,
    },
  ];

  const out: { variant: string; assetId: string; ratio: string | null }[] = [];
  for (const r of ratios) {
    const assetId = r.captioned ?? r.master ?? null;
    if (assetId) out.push({ variant: r.variant, assetId, ratio: r.ratio });
  }
  // Do not append finalExport_travy_assetId. A normal requester-facing export
  // remains eligible when Travy happens to reuse the same underlying asset, but
  // a separate Travy render must stay under RClipper admin management.
  // De-duplicate defensively in case two requester variants reuse one asset.
  const unique = new Map<string, (typeof out)[number]>();
  for (const entry of out) {
    if (!unique.has(entry.assetId)) unique.set(entry.assetId, entry);
  }
  return Array.from(unique.values());
}

/**
 * Pipeline steps at which the finished per-channel exports exist and are
 * therefore transferable.
 *
 * `AwaitingDistributionReview` is the download step — the exports are ready and
 * the user is downloading them, which is exactly where the transfer panel is
 * shown. Excluding it made the panel report "not ready to transfer" on the very
 * step it appears on. `Publishing`/`Complete` are the later terminal states.
 */
const COMPLETED_STEPS: VideoGenerationStep[] = [
  VideoGenerationStep.AwaitingDistributionReview,
  VideoGenerationStep.Publishing,
  VideoGenerationStep.Complete,
];

export class ManagementEntitlementService {
  constructor(
    private requests = clipRequestRepository,
    private jobs = videoGenerationJobRepository,
    private passes = managementAccessPassRepository,
    private bundles = managementUploadBundleRepository,
    private content = managementContentRepository
  ) {}

  /**
   * The user's current access window across every live pass, or null.
   *
   * "Effective" means the furthest-future expiry: overlapping purchases are
   * additive, so holding a pass to March and another to June means June.
   */
  async effectiveAccess(
    userId: string,
    now: Date = new Date()
  ): Promise<{ passId: string; startsAt: Date; expiresAt: Date } | null> {
    const latest = await this.passes.findEffectiveExpiry(userId);
    if (!latest) return null;
    return latest.expiresAt.getTime() > now.getTime() ? latest : null;
  }

  /**
   * May this completed generation project be transferred into Management?
   *
   * FREE — no payment is considered here. Only: the feature is on, the project
   * is theirs, the generation finished, and it produced media. Transfer is also
   * optional: nothing in the download flow depends on the answer.
   */
  async checkTransferEligibility(
    user: { id: string; email?: string | null; role?: string | null },
    sourceGenerationId: string
  ): Promise<ManagementTransferEligibility> {
    const no = (
      reason: ManagementTransferEligibility["reason"]
    ): ManagementTransferEligibility => ({
      allowed: false,
      alreadyTransferred: false,
      videoCount: 0,
      reason,
    });

    if (!isManagementEnabledFor(user)) return no("feature_disabled");

    const request = await this.requests.findById(sourceGenerationId);
    // A missing project and a foreign project return the same reason, so this
    // cannot be used to probe for other users' request ids.
    if (!request || request.userId !== user.id) return no("not_owner");

    const job = await this.jobs.findByRequestId(sourceGenerationId);
    if (!job) return no("generation_incomplete");
    const finished =
      job.status === VideoGenerationJobStatus.Complete ||
      COMPLETED_STEPS.includes(job.currentStep);
    if (!finished) return no("generation_incomplete");

    const videoCount = eligibleExportAssetIds(job).length;
    if (videoCount === 0) return no("no_eligible_media");

    const existing = await this.content.findBySource(user.id, sourceGenerationId);
    if (existing) {
      return {
        allowed: true,
        alreadyTransferred: true,
        managementContentId: existing.id,
        videoCount,
      };
    }

    return { allowed: true, alreadyTransferred: false, videoCount };
  }

  /**
   * May this user PUBLISH this content item right now? This is the paid gate.
   *
   * `requiredTokens` is the number of publication TARGETS this publish will
   * create — one token is spent per target. The composer passes the count so the
   * gate can confirm the whole fan-out is affordable before any target is
   * written. Defaults to 1 for a single-destination check.
   *
   * Checks, in order:
   *   1. feature enabled for this user
   *   2. the item exists and belongs to them
   *   3. it still has usable media (not purged, not mid-upload)
   *   4. an active access pass (unlimited publishing)      -> allowed, no tokens
   *   5. at least `requiredTokens` spendable upload tokens  -> allowed
   *   6. otherwise payment is required
   *
   * The pass is checked BEFORE tokens so a pass holder never spends a token.
   * This method only CONFIRMS affordability; tokens are actually spent, race-
   * proof, by `ManagementPublicationService` at creation time.
   */
  async evaluateForPublish(
    user: { id: string; email?: string | null; role?: string | null },
    managementContentId: string,
    now: Date = new Date(),
    requiredTokens = 1
  ): Promise<ManagementEntitlement> {
    if (!isManagementEnabledFor(user)) return deny("feature_disabled");

    const item = await this.content.findById(managementContentId);
    if (!item) return deny("content_not_found");
    if (item.userId !== user.id) return deny("not_owner");

    if (!hasUsableMedia(item)) return deny("media_expired");

    const access = await this.effectiveAccess(user.id, now);
    if (access) {
      return {
        allowed: true,
        entitlementType: ManagementEntitlementType.ThreeMonths,
        accessPassId: access.passId,
        startsAt: access.startsAt,
        expiresAt: access.expiresAt,
      };
    }

    const tokensRemaining = await this.bundles.countSpendableTokens(user.id, now);
    if (tokensRemaining >= requiredTokens) {
      return {
        allowed: true,
        entitlementType: ManagementEntitlementType.SingleVideo,
        tokensRemaining,
      };
    }

    // Distinguish "never had access" from "had access, it lapsed" — the wording
    // differs and users notice. A user who has SOME tokens but not enough is
    // told payment is required (buy another bundle), not that access expired.
    const everHadPass = (await this.passes.findByUserId(user.id)).length > 0;
    return {
      ...deny(everHadPass && tokensRemaining === 0 ? "access_expired" : "payment_required"),
      tokensRemaining,
    };
  }

  /**
   * May this user start ANY new publication? Used for dashboard-level affordances
   * that are not tied to one item (e.g. enabling the composer entry point).
   *
   * True when the user holds an active pass OR has at least one spendable upload
   * token. The per-item, count-aware `evaluateForPublish` remains the authority
   * at publish time.
   */
  async evaluateForAnyPublish(
    user: { id: string; email?: string | null; role?: string | null },
    now: Date = new Date()
  ): Promise<ManagementEntitlement> {
    if (!isManagementEnabledFor(user)) return deny("feature_disabled");

    const access = await this.effectiveAccess(user.id, now);
    if (access) {
      return {
        allowed: true,
        entitlementType: ManagementEntitlementType.ThreeMonths,
        accessPassId: access.passId,
        startsAt: access.startsAt,
        expiresAt: access.expiresAt,
      };
    }

    const tokensRemaining = await this.bundles.countSpendableTokens(user.id, now);
    if (tokensRemaining > 0) {
      return {
        allowed: true,
        entitlementType: ManagementEntitlementType.SingleVideo,
        tokensRemaining,
      };
    }

    const everHadPass = (await this.passes.findByUserId(user.id)).length > 0;
    return {
      ...deny(everHadPass ? "access_expired" : "payment_required"),
      tokensRemaining,
    };
  }
}

export const managementEntitlementService = new ManagementEntitlementService();
