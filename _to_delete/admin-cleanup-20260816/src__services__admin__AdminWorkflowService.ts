import { RequestStatus } from "@/domain/enums/RequestStatus";
import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";
import { ClipRequest } from "@/domain/models/ClipRequest";
import { ProductionReview } from "@/domain/models/ProductionReview";
import {
  clipRequestRepository,
  requestStatusHistoryRepository,
  productionReviewRepository,
} from "@/repositories";

/**
 * AdminWorkflowService — admin-side production review and approval workflow.
 *
 * Workflow handled here:
 *   ScheduledForPublishing → Published      (approve for publishing)
 *   ScheduledForPublishing → Editing        (return to editing with revision note)
 *   ScheduledForPublishing → OnHold         (hold with requester-visible reason)
 *   ScheduledForPublishing → Rejected       (reject with requester-visible reason)
 *
 * For each transition, the corresponding ProductionReview record is also updated
 * to reflect the admin decision.
 *
 * Key rule: Only admin may call these methods.
 *   Enforce this at the API layer using requireRole(Role.Admin).
 *
 * TODO: PostgreSQL — wrap each transition in a DB transaction so the
 *   status update, history log, and production review update are atomic.
 */
export class AdminWorkflowService {
  /**
   * Approve a clip for publishing.
   * Moves: ScheduledForPublishing → Published
   * Updates: ProductionReview → Approved
   *
   * After this action, staff can record publishing links and mark Delivered.
   * Requester will see the Published status.
   */
  async approveForPublishing(
    requestId: string,
    adminId: string,
    reviewNote?: string
  ): Promise<{ request: ClipRequest; review: ProductionReview }> {
    const request = await this.requireStatus(requestId, RequestStatus.ScheduledForPublishing);
    const review = await this.requireLatestReview(requestId);

    const updatedReview = await productionReviewRepository.update(review.id, {
      status: ProductionReviewStatus.Approved,
      reviewedBy: adminId,
      reviewNote: reviewNote?.trim(),
    });

    const updatedRequest = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.Published
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Published,
      note: reviewNote?.trim() ?? "Approved by admin. Clip is ready for publishing.",
      changedAt: new Date(),
    });

    return { request: updatedRequest, review: updatedReview };
  }

  /**
   * Return a clip to editing for revisions.
   * Moves: ScheduledForPublishing → Editing
   * Updates: ProductionReview → ReturnedToEditing
   *
   * A revision note is required so staff know what to change.
   * When staff resubmit, a new ProductionReview record will be created.
   */
  async returnToEditing(
    requestId: string,
    adminId: string,
    revisionNote: string
  ): Promise<{ request: ClipRequest; review: ProductionReview }> {
    if (!revisionNote?.trim()) {
      throw new Error("A revision note is required when returning a clip to editing.");
    }

    const request = await this.requireStatus(requestId, RequestStatus.ScheduledForPublishing);
    const review = await this.requireLatestReview(requestId);

    const updatedReview = await productionReviewRepository.update(review.id, {
      status: ProductionReviewStatus.ReturnedToEditing,
      reviewedBy: adminId,
      reviewNote: revisionNote.trim(),
    });

    const updatedRequest = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.Editing
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Editing,
      note: `Returned to editing. Admin note: ${revisionNote.trim()}`,
      changedAt: new Date(),
    });

    return { request: updatedRequest, review: updatedReview };
  }

  /**
   * Hold a request during production review (admin holds, reason shown to requester).
   * Moves: ScheduledForPublishing → OnHold
   * Updates: ProductionReview → OnHold
   *
   * Use when production review cannot proceed until requester provides more info.
   * Staff can resume from hold later.
   */
  async holdDuringReview(
    requestId: string,
    adminId: string,
    holdReason: string,
    reviewNote?: string
  ): Promise<{ request: ClipRequest; review: ProductionReview }> {
    if (!holdReason?.trim()) {
      throw new Error("A hold reason is required (shown to requester).");
    }

    const request = await this.requireStatus(requestId, RequestStatus.ScheduledForPublishing);
    const review = await this.requireLatestReview(requestId);

    const updatedReview = await productionReviewRepository.update(review.id, {
      status: ProductionReviewStatus.OnHold,
      reviewedBy: adminId,
      reviewNote: reviewNote?.trim(),
    });

    const updatedRequest = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.OnHold,
      { holdReason: holdReason.trim() }
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.OnHold,
      note: reviewNote?.trim() ?? `Admin hold during production review. Reason: ${holdReason.trim()}`,
      changedAt: new Date(),
    });

    return { request: updatedRequest, review: updatedReview };
  }

  /**
   * Reject a clip directly from production review (requester-visible reason required).
   * Moves: ScheduledForPublishing → Rejected
   * Updates: ProductionReview → Rejected
   */
  async rejectFromReview(
    requestId: string,
    adminId: string,
    rejectionReason: string,
    reviewNote?: string
  ): Promise<{ request: ClipRequest; review: ProductionReview }> {
    if (!rejectionReason?.trim()) {
      throw new Error("A rejection reason is required (shown to requester).");
    }

    const request = await this.requireStatus(requestId, RequestStatus.ScheduledForPublishing);
    const review = await this.requireLatestReview(requestId);

    const updatedReview = await productionReviewRepository.update(review.id, {
      status: ProductionReviewStatus.Rejected,
      reviewedBy: adminId,
      reviewNote: reviewNote?.trim(),
    });

    const updatedRequest = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.Rejected,
      {
        rejectionReason: rejectionReason.trim(),
        assignedStaffId: null,
      }
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Rejected,
      note: reviewNote?.trim() ?? `Admin rejected during production review. Reason: ${rejectionReason.trim()}`,
      changedAt: new Date(),
    });

    return { request: updatedRequest, review: updatedReview };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async requireStatus(
    requestId: string,
    expectedStatus: RequestStatus
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);
    if (request.status !== expectedStatus) {
      throw new Error(
        `Expected request to be in "${expectedStatus}" status. Current: "${request.status}".`
      );
    }
    return request;
  }

  private async requireLatestReview(requestId: string): Promise<ProductionReview> {
    const review = await productionReviewRepository.findLatestByRequestId(requestId);
    if (!review) {
      // Create one on-the-fly if staff submitted without creating a record
      // (e.g., for requests submitted before Phase 2D was deployed)
      return productionReviewRepository.create({
        requestId,
        submittedAt: new Date(),
      });
    }
    return review;
  }
}

export const adminWorkflowService = new AdminWorkflowService();
