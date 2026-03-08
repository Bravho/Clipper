import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ClipRequest, CreateClipRequestInput } from "@/domain/models/ClipRequest";
import { ClipRequestFormValues } from "@/features/requests/validation/clipRequestSchema";
import { CREDITS_CONFIG } from "@/config/credits";
import {
  clipRequestRepository,
  requestStatusHistoryRepository,
} from "@/repositories";
import { creditService } from "@/services/CreditService";

/**
 * ClipRequestService — manages the full lifecycle of a clip request
 * from draft creation through submission.
 *
 * Business rules enforced here:
 * - A requester must have sufficient credits before submission.
 * - Credits are deducted atomically with status change to Submitted.
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
    data: ClipRequestFormValues
  ): Promise<ClipRequest> {
    const input: CreateClipRequestInput = {
      userId,
      title: data.title,
      description: data.description,
      targetAudience: data.targetAudience,
      targetPlatforms: data.targetPlatforms,
      preferredStyle: data.preferredStyle,
      // preferredLanguage removed from the form — stored as empty string
      preferredLanguage: "",
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
    rightsConfirmed: boolean
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

    const canAfford = await creditService.hasEnoughCredits(
      userId,
      CREDITS_CONFIG.REQUEST_COST_CREDITS
    );
    if (!canAfford) {
      throw new Error(
        `Insufficient credits. You need ${CREDITS_CONFIG.REQUEST_COST_CREDITS} credits to submit a request.`
      );
    }

    // Deduct credits
    // TODO: PostgreSQL — wrap this and the status update in a DB transaction
    //   to prevent partial state if either operation fails.
    await creditService.deductCredits(
      userId,
      CREDITS_CONFIG.REQUEST_COST_CREDITS,
      `Clip request: ${existing.title}`,
      requestId
    );

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
    // TODO: DigitalOcean Spaces — call UploadService.deleteAssetsByRequestId(requestId)
    //   to remove uploaded source files from DO Spaces before deleting the DB record.
    await clipRequestRepository.delete(requestId);
  }

  /**
   * Estimate a rough queue position for a newly submitted request.
   *
   * TODO: PostgreSQL — implement as:
   *   SELECT COUNT(*) FROM clip_requests
   *   WHERE status IN ('submitted','under_review','accepted_for_production')
   *   AND submitted_at < NOW()
   */
  private async estimateQueuePosition(): Promise<number> {
    // Mock: return a small random queue position
    return Math.floor(Math.random() * 5) + 3;
  }
}

// Singleton instance
export const clipRequestService = new ClipRequestService();

// Re-exported for convenience — consumers can import either from here or from CreditService directly
export { creditService };
