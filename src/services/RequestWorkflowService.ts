import { RequestStatus } from "@/domain/enums/RequestStatus";
import { EffortClass } from "@/domain/enums/EffortClass";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { ClipRequest } from "@/domain/models/ClipRequest";
import {
  clipRequestRepository,
  requestStatusHistoryRepository,
  uploadedAssetRepository,
  productionReviewRepository,
} from "@/repositories";
import { dueDateConfirmationService } from "./DueDateConfirmationService";

/**
 * StaffWorkflowService — simplified production workflow.
 *
 * Workflow:
 *   Submitted → Editing        (staff confirms due date + accepts in one action)
 *   Editing   → ScheduledForPublishing  (staff submits for production/admin review)
 *   ScheduledForPublishing → Published  (admin approves for publishing to requester)
 *   ScheduledForPublishing → Editing    (admin sends back for revision)
 *   Published → Delivered
 *   Any active → OnHold | Rejected
 *   OnHold → Submitted         (resume — staff re-reviews and re-accepts)
 *
 * Key rule: staff MUST confirm due date before accepting a request.
 *   acceptAndStartEditing() enforces this — it requires a confirmed date.
 *
 * TODO: Admin Portal — approveForPublishing() and returnToEditing() should
 *   eventually be admin-only actions. For now staff can perform them until
 *   the admin portal is built.
 *
 * TODO: PostgreSQL — wrap each transition in a DB transaction so the
 *   status update and history log are atomic.
 */

const ALLOWED_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
  [RequestStatus.Submitted]: [
    RequestStatus.UnderReview,
    RequestStatus.OnHold,
    RequestStatus.Rejected,
  ],
  [RequestStatus.UnderReview]: [
    RequestStatus.AcceptedForProduction,
    RequestStatus.OnHold,
    RequestStatus.Rejected,
  ],
  [RequestStatus.AcceptedForProduction]: [
    RequestStatus.Editing,
    RequestStatus.OnHold,
    RequestStatus.Rejected,
  ],
  [RequestStatus.Rejected]: [],  // terminal
  [RequestStatus.Editing]: [
    RequestStatus.ScheduledForPublishing,
    RequestStatus.OnHold,
    RequestStatus.Rejected,
  ],
  [RequestStatus.ScheduledForPublishing]: [
    RequestStatus.Published,
    RequestStatus.OnHold,
  ],
  [RequestStatus.Published]: [
    RequestStatus.Delivered,
  ],
  [RequestStatus.OnHold]: [
    RequestStatus.UnderReview,  // resume — back to review queue
    RequestStatus.Rejected,
  ],
};

export class RequestWorkflowService {
  isValidTransition(from: RequestStatus, to: RequestStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  getAllowedTransitions(from: RequestStatus): RequestStatus[] {
    return ALLOWED_TRANSITIONS[from] ?? [];
  }

  /**
   * Accept a submitted request and start editing.
   *
   * This is the PRIMARY staff acceptance action. It combines:
   *   1. Setting effort class
   *   2. Confirming due date (REQUIRED — staff cannot accept without it)
   *   3. Transitioning status from Submitted → Editing
   *
   * The requester sees the confirmed due date immediately after this action.
   *
   * @param confirmedDate - Date staff commits to (required, must be provided)
   * @param effortClass   - Effort classification (required)
   */
  /**
   * Mark a submitted request as under review.
   * Moves: Submitted → UnderReview
   */
  async markUnderReview(requestId: string, note?: string): Promise<ClipRequest> {
    return this.transition(
      requestId,
      RequestStatus.UnderReview,
      note ?? "Request is now under review."
    );
  }

  async acceptAndStartEditing(
    requestId: string,
    staffId: string,
    confirmedDate: Date,
    effortClass: EffortClass,
    note?: string
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    if (
      request.status !== RequestStatus.Submitted &&
      request.status !== RequestStatus.Rejected
    ) {
      throw new Error(
        `Only Submitted or Rejected requests can be accepted. Current status: ${request.status}`
      );
    }

    // Enforce one-at-a-time: a staff member may only have one active Editing
    // assignment. They must submit for production review before accepting another.
    const editingRequests = await clipRequestRepository.findByStatus([RequestStatus.Editing]);
    const alreadyEditing = editingRequests.find(
      (r) => r.assignedStaffId === staffId && r.id !== requestId
    );
    if (alreadyEditing) {
      throw new Error(
        `You already have request "${alreadyEditing.title}" in editing. Submit it for production review before accepting another.`
      );
    }

    if (!confirmedDate || isNaN(confirmedDate.getTime())) {
      throw new Error(
        "A confirmed due date is required before accepting a request."
      );
    }

    if (confirmedDate < new Date()) {
      throw new Error("Confirmed due date cannot be in the past.");
    }

    const systemEstimate = dueDateConfirmationService.estimateDueDate(effortClass);

    // Update effort class + system estimate
    await clipRequestRepository.updateStaffFields(requestId, { effortClass });

    // Set confirmed due date, assign staff, transition to Editing
    const updated = await clipRequestRepository.updateStatus(
      requestId,
      RequestStatus.Editing,
      {
        estimatedDueDate: systemEstimate,
        confirmedDueDate: confirmedDate,
        dueDateConfirmed: true,
        assignedStaffId: staffId,
      }
    );

    const now = new Date();
    const wasRejected = request.status === RequestStatus.Rejected;
    await requestStatusHistoryRepository.create({
      requestId,
      status: RequestStatus.Editing,
      note: note?.trim()
        ? note.trim()
        : `${wasRejected ? "Re-accepted" : "Accepted"}. Due date confirmed: ${confirmedDate.toLocaleDateString("en-GB")}. Effort: ${effortClass}.`,
      changedAt: now,
    });

    return updated;
  }

  /**
   * Staff submits completed editing for production/admin review.
   * Moves: Editing → ScheduledForPublishing
   *
   * Requires at least one uploaded EditedClip asset — the admin must have
   * something to review before approving for publishing.
   */
  async submitForProductionReview(requestId: string, note?: string): Promise<ClipRequest> {
    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    const hasEditedClip = assets.some(
      (a) =>
        a.assetType === AssetType.EditedClip &&
        a.uploadStatus === AssetUploadStatus.Uploaded
    );
    if (!hasEditedClip) {
      throw new Error(
        "An edited clip must be uploaded before submitting for production review."
      );
    }
    const updated = await this.transition(
      requestId,
      RequestStatus.ScheduledForPublishing,
      note ?? "Editing complete. Submitted for production review."
    );

    // Create a production review record for admin to act on.
    // TODO: Admin Portal — admin will see this record in the production review queue.
    await productionReviewRepository.create({
      requestId,
      submittedAt: new Date(),
    });

    return updated;
  }

  /**
   * Admin approves the production review — clip is ready for publishing.
   * Moves: ScheduledForPublishing → Published
   *
   * TODO: Admin Portal — restrict this action to admin role only.
   */
  async approveForPublishing(requestId: string, note?: string): Promise<ClipRequest> {
    return this.transition(
      requestId,
      RequestStatus.Published,
      note ?? "Approved for publishing."
    );
  }

  /**
   * Admin sends the clip back to editing for revisions.
   * Moves: ScheduledForPublishing → Editing
   *
   * TODO: Admin Portal — restrict this action to admin role only.
   */
  async returnToEditing(requestId: string, note?: string): Promise<ClipRequest> {
    if (!note?.trim()) {
      throw new Error("A revision note is required when returning to editing.");
    }
    return this.transition(requestId, RequestStatus.Editing, note.trim());
  }

  /**
   * Mark a request as Delivered once all publishing links are confirmed.
   * Moves: Published → Delivered
   */
  async markDelivered(requestId: string, note?: string): Promise<ClipRequest> {
    return this.transition(requestId, RequestStatus.Delivered, note);
  }

  /**
   * Put a request On Hold. Requires a reason shown to the requester.
   */
  async putOnHold(
    requestId: string,
    holdReason: string,
    internalNote?: string
  ): Promise<ClipRequest> {
    if (!holdReason?.trim()) {
      throw new Error("A hold reason is required.");
    }
    return this.transition(requestId, RequestStatus.OnHold, internalNote, {
      holdReason: holdReason.trim(),
    });
  }

  /**
   * Reject a request. Requires a reason shown to the requester.
   */
  async rejectRequest(
    requestId: string,
    rejectionReason: string,
    internalNote?: string
  ): Promise<ClipRequest> {
    if (!rejectionReason?.trim()) {
      throw new Error("A rejection reason is required.");
    }
    return this.transition(requestId, RequestStatus.Rejected, internalNote, {
      rejectionReason: rejectionReason.trim(),
      assignedStaffId: null,
    });
  }

  /**
   * Resume a request from On Hold → back to Submitted queue.
   * Staff will then re-review and re-accept.
   */
  async resumeFromHold(requestId: string, note?: string): Promise<ClipRequest> {
    return this.transition(requestId, RequestStatus.UnderReview, note, {
      holdReason: null,
      assignedStaffId: null,
    });
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private async transition(
    requestId: string,
    toStatus: RequestStatus,
    note?: string,
    extra?: Partial<Pick<ClipRequest, "holdReason" | "rejectionReason" | "assignedStaffId">>
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    if (!this.isValidTransition(request.status, toStatus)) {
      throw new Error(
        `Cannot transition from "${request.status}" to "${toStatus}".`
      );
    }

    const updated = await clipRequestRepository.updateStatus(
      requestId,
      toStatus,
      extra
    );

    await requestStatusHistoryRepository.create({
      requestId,
      status: toStatus,
      note: note?.trim() ?? null,
      changedAt: new Date(),
    });

    return updated;
  }
}

export const requestWorkflowService = new RequestWorkflowService();
