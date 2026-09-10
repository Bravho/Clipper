import { RequestStatus } from "@/domain/enums/RequestStatus";
import { EditorType } from "@/domain/enums/EditorType";
import { ClipRequest, CreateClipRequestInput } from "@/domain/models/ClipRequest";
import { ClipRequestFormValues } from "@/features/requests/validation/clipRequestSchema";
import { videoQuotaService, VideoQuota } from "@/services/VideoQuotaService";
import { RequestPricingTier } from "@/domain/enums/RequestPricingTier";
import {
  clipRequestRepository,
  requestStatusHistoryRepository,
} from "@/repositories";
import { creditService } from "@/services/CreditService";
import { uploadService } from "@/services/UploadService";
import type { AppLocale } from "@/i18n/config";

/**
 * ClipRequestService — manages the full lifecycle of a clip request
 * from draft creation through submission.
 *
 * Business rules enforced here:
 * - A requester must have quota left before submission — 3 free per rolling 30
 *   days, or 10 per month on a purchased package (see `VideoQuotaService`).
 * - No credits are deducted per request; a quota slot is consumed instead.
 * - Legal confirmations (credit + rights) are required at submission.
 * - A draft may be updated freely until submitted.
 * - Only Draft requests may be submitted.
 *
 * TODO: PostgreSQL — wrap credit deduction + status update in a DB transaction
 *   to prevent partial state (e.g., credits deducted but status not updated).
 */
export class ClipRequestService {
  /**
   * Create a new draft request for a requester.
   * Does NOT charge credits — credits are charged at submission.
   */
  async createDraft(
    userId: string,
    data: ClipRequestFormValues,
    contentLanguage: AppLocale = "th"
  ): Promise<ClipRequest> {
    const input: CreateClipRequestInput = {
      userId,
      title: data.title,
      placeName: data.placeName,
      latitude: data.latitude,
      longitude: data.longitude,
      description: data.description,
      targetAudience: data.targetAudience,
      targetPlatforms: data.targetPlatforms,
      preferredStyle: "",
      preferredLanguage: contentLanguage,
      durationSeconds: data.durationSeconds,
    };

    const request = await clipRequestRepository.create(input);

    // Log Draft status history entry
    await requestStatusHistoryRepository.create({
      requestId: request.id,
      status: RequestStatus.Draft,
      note: null,
      changedAt: request.createdAt,
    });

    return request;
  }

  /**
   * Update a draft request.
   * Only allowed while status is Draft.
   */
  async updateDraft(
    requestId: string,
    userId: string,
    data: Partial<ClipRequestFormValues>
  ): Promise<ClipRequest> {
    const existing = await this.getOwnedRequest(requestId, userId);

    if (existing.status !== RequestStatus.Draft) {
      throw new Error("Only Draft requests can be edited.");
    }

    return clipRequestRepository.update(requestId, data);
  }

  /**
   * Submit a draft request.
   *
   * Validates:
   * 1. Request exists and belongs to userId
   * 2. Request is currently in Draft status
   * 3. Both legal confirmations are true
   * 4. Requester has sufficient credits
   *
   * On success:
   * - Deducts credits
   * - Updates status to Submitted
   * - Records status history entry
   * - Sets submittedAt timestamp
   */
  async submitRequest(
    requestId: string,
    userId: string,
    creditConfirmed: boolean,
    rightsConfirmed: boolean,
    aiProcessingConfirmed: boolean
  ): Promise<ClipRequest> {
    const existing = await this.getOwnedRequest(requestId, userId);

    if (existing.status !== RequestStatus.Draft) {
      throw new Error("Only Draft requests can be submitted.");
    }

    if (!creditConfirmed) {
      throw new Error("Credit use confirmation is required to submit.");
    }

    if (!rightsConfirmed) {
      throw new Error("Rights confirmation is required to submit.");
    }

    if (!aiProcessingConfirmed) {
      throw new Error("AI processing permission is required to submit.");
    }

    // Take a quota slot: a paid month's request if the account has a live
    // package, otherwise one of the 3 free per rolling 30 days. Throws
    // QuotaExhaustedError when neither is available, which the API turns into a
    // 402 pointing at the pricing page.
    //
    // Consumed BEFORE the status flip so a submission can never exist without a
    // slot behind it. If the flip then fails, the request stays a Draft holding
    // one slot until the render fails or the user resubmits — the safe direction,
    // since the alternative oversells the worker.
    const consumed = await videoQuotaService.consume(userId);

    const now = new Date();
    const queuePos = await this.estimateQueuePosition();

    // Update request to Submitted, recording legal confirmations + timestamps
    // TODO: PostgreSQL — wrap this entire block in a DB transaction
    const submitted = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.Submitted,
      {
        submittedAt: now,
        queuePosition: queuePos,
        creditConfirmed: true,
        rightsConfirmed: true,
        aiProcessingConfirmed: true,
        aiConsentVersion: "1.0.0",
        aiConsentAcceptedAt: now,
        pricingTier: consumed.tier,
        // Which purchased month paid for this, so a failed render can give it
        // back. Null on the free tier — that allowance simply ages out.
        videoAllowanceWindowId: consumed.allowanceWindowId,
        // Historical field from the per-request pricing era; nothing is charged
        // at submission any more.
        isTrialRequest: consumed.tier === RequestPricingTier.Free,
        // No paywall: every request is downloadable once produced. The flag and
        // the watermark machinery behind it are retained, not used.
        downloadUnlocked: true,
      }
    );

    // Log status history
    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Submitted,
      note: null,
      changedAt: now,
    });

    return submitted;
  }

  /** Get a single request, ensuring it belongs to the specified user. */
  async getOwnedRequest(
    requestId: string,
    userId: string
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error("Request not found.");
    if (request.userId !== userId) throw new Error("Access denied.");
    return request;
  }

  /** List all requests for a requester, newest first. */
  async listForUser(userId: string): Promise<ClipRequest[]> {
    return clipRequestRepository.findByUserId(userId);
  }

  /** List active (in-progress) requests for a requester. */
  async listActiveForUser(userId: string): Promise<ClipRequest[]> {
    const active: RequestStatus[] = [
      RequestStatus.Submitted,
      RequestStatus.UnderReview,
      RequestStatus.AcceptedForProduction,
      RequestStatus.Editing,
      RequestStatus.ScheduledForPublishing,
    ];
    return clipRequestRepository.findByUserIdAndStatus(userId, active);
  }

  /**
   * Delete a draft request.
   * Only allowed for Draft status.
   */
  async deleteDraft(requestId: string, userId: string): Promise<void> {
    const existing = await this.getOwnedRequest(requestId, userId);
    if (existing.status !== RequestStatus.Draft) {
      throw new Error("Only Draft requests can be deleted.");
    }
    await uploadService.deleteAssetsByRequestId(requestId);
    await clipRequestRepository.delete(requestId);
  }

  /**
   * Cancel a request that has not yet entered production.
   * Allowed statuses: Draft, Submitted.
   * For Submitted requests, the 10-credit charge is refunded automatically.
   */
  async cancelRequest(requestId: string, userId: string): Promise<void> {
    const existing = await this.getOwnedRequest(requestId, userId);
    const cancellable = [RequestStatus.Draft, RequestStatus.Submitted];
    if (!cancellable.includes(existing.status)) {
      throw new Error("Only Draft or Submitted requests can be cancelled.");
    }
    await uploadService.deleteAssetsByRequestId(requestId);
    await clipRequestRepository.delete(requestId);
  }

  // ── Marketplace methods ─────────────────────────────────────────────────────

  /**
   * Assign an editor and record payment details.
   * Called at checkout after payment is confirmed.
   *
   * Sets:
   * - assignedEditorId, editorType, priceBaht, creditsUsed, discountBaht, amountPaidBaht
   * - Status → Submitted
   */
  async assignEditorAndSubmit(
    requestId: string,
    userId: string,
    editorProfileId: string,
    editorType: EditorType,
    priceBaht: number,
    creditsUsed: number,
    discountBaht: number,
    amountPaidBaht: number,
    rightsConfirmed: boolean
  ): Promise<ClipRequest> {
    const existing = await this.getOwnedRequest(requestId, userId);

    if (existing.status !== RequestStatus.Draft) {
      throw new Error("Only Draft requests can be submitted.");
    }
    if (!rightsConfirmed) {
      throw new Error("Rights confirmation is required to submit.");
    }

    const now = new Date();
    const queuePos = await this.estimateQueuePosition();

    const submitted = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.Submitted,
      {
        assignedEditorId: editorProfileId,
        editorType,
        priceBaht,
        creditsUsed,
        discountBaht,
        amountPaidBaht,
        submittedAt: now,
        queuePosition: queuePos,
        creditConfirmed: true,
        rightsConfirmed: true,
      }
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Submitted,
      note: `Assigned to editor ${editorProfileId} (${editorType})`,
      changedAt: now,
    });

    return submitted;
  }

  /**
   * Requester approves the delivered clip from a human editor.
   * Advances status to Delivered.
   */
  async approveDelivery(requestId: string, userId: string): Promise<ClipRequest> {
    const existing = await this.getOwnedRequest(requestId, userId);

    const allowedStatuses: RequestStatus[] = [
      RequestStatus.ScheduledForPublishing,
      RequestStatus.RevisionRequested,
    ];
    if (!allowedStatuses.includes(existing.status)) {
      throw new Error("Request is not in a state where delivery can be approved.");
    }

    const now = new Date();
    const delivered = await clipRequestRepository.updateStatus(requestId, RequestStatus.Delivered);

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Delivered,
      note: "Requester approved delivery.",
      changedAt: now,
    });

    // Subscriber benefit: a paid request's masters move out of the short
    // final_exports/ window into paid_exports/ (30 days), resetting the storage
    // clock. Free-tier deliverables keep the standard window. Best-effort — a
    // storage hiccup must never fail a delivery the user just approved; the
    // master would simply expire on its original window instead.
    if (existing.pricingTier === RequestPricingTier.Paid) {
      try {
        const { paidExportRetentionService } = await import(
          "@/services/PaidExportRetentionService"
        );
        await paidExportRetentionService.promoteForRequest(userId, requestId);
      } catch (err) {
        console.error(
          `[approveDelivery] paid-export promotion failed for ${requestId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return delivered;
  }

  /**
   * Requester requests a revision from the human editor.
   * Increments revisionCount and sets status to RevisionRequested.
   */
  async requestRevision(
    requestId: string,
    userId: string,
    reason: string
  ): Promise<ClipRequest> {
    const existing = await this.getOwnedRequest(requestId, userId);

    if (existing.status !== RequestStatus.ScheduledForPublishing) {
      throw new Error("Revisions can only be requested after a deliverable has been submitted.");
    }

    const now = new Date();
    const withStatus = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.RevisionRequested,
      { revisionCount: (existing.revisionCount ?? 0) + 1 }
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.RevisionRequested,
      note: reason,
      changedAt: now,
    });

    return withStatus;
  }

  /**
   * Editor submits a completed deliverable.
   * Moves status to ScheduledForPublishing (awaiting requester review).
   */
  async submitDeliverable(
    requestId: string,
    editorUserId: string,
    assetId: string
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error("Request not found.");

    const allowedStatuses: RequestStatus[] = [
      RequestStatus.Editing,
      RequestStatus.AcceptedForProduction,
      RequestStatus.RevisionRequested,
    ];
    if (!allowedStatuses.includes(request.status)) {
      throw new Error("Deliverable can only be submitted while the request is in editing.");
    }

    const now = new Date();
    const updated = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.ScheduledForPublishing
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.ScheduledForPublishing,
      note: `Deliverable submitted (asset: ${assetId})`,
      changedAt: now,
    });

    return updated;
  }

  /**
   * What the user's NEXT request may draw on — the paid month if they have one,
   * otherwise the free allowance. Read-only; nothing is consumed.
   *
   * Delegates to {@link VideoQuotaService} so the dashboard, the request form and
   * `submitRequest` all read one implementation of the rule.
   */
  async getQuota(userId: string): Promise<VideoQuota> {
    return videoQuotaService.getQuota(userId);
  }

  /**
   * NOTE — the pay-to-download paywall was removed here.
   *
   * `unlockDownload()` and `_resumeAfterUnlock()` charged the request price to
   * release a watermarked preview and then resumed the pipeline. Access is now a
   * monthly quota (see VideoQuotaService), so there is nothing to unlock: every
   * request is downloadable once produced. The watermark renderer and the
   * `downloadUnlocked` flag are retained but dormant — see ClipRequest.
   */

  /**
   * Estimate a rough queue position for a newly submitted request.
   *
   * TODO: PostgreSQL — implement as:
   *   SELECT COUNT(*) FROM clip_requests
   *   WHERE status IN ('submitted','under_review','accepted_for_production')
   *   AND submitted_at < NOW()
   */
  private async estimateQueuePosition(): Promise<number> {
    return Math.floor(Math.random() * 5) + 3;
  }
}

// Singleton instance
export const clipRequestService = new ClipRequestService();

// Re-exported for convenience — consumers can import either from here or from CreditService directly
export { creditService };
