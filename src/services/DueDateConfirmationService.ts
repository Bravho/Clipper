import { ClipRequest } from "@/domain/models/ClipRequest";
import { EffortClass, EFFORT_CLASS_DAYS } from "@/domain/enums/EffortClass";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { clipRequestRepository, requestStatusHistoryRepository } from "@/repositories";

/**
 * DueDateConfirmationService — manages due date estimation and confirmation workflow.
 *
 * Business rules:
 * - System estimates a due date based on effort class + working days.
 * - Staff must explicitly confirm the due date with a button action.
 * - Requesters ONLY see the due date after staff confirms it.
 * - Before confirmation, requesters see a "pending review" message.
 * - Staff may confirm a different date than the system estimate.
 * - If staff changes the effort class, the system re-estimates automatically.
 *
 * Due date calculation:
 *   - Simple:   +1 working day from today
 *   - Standard: +2 working days from today
 *   - Complex:  +3 working days from today
 *   - Weekend days are skipped (Mon–Fri only).
 *
 * TODO: PostgreSQL — no special transaction needed here;
 *   the updateStatus call handles the confirmed_due_date + due_date_confirmed columns.
 *   Future: queue depth factor should be computed as:
 *     SELECT COUNT(*) FROM clip_requests
 *     WHERE status IN ('accepted_for_production','editing')
 *     AND submitted_at < NOW()
 *   and added to the estimate.
 *
 * TODO: Admin Portal — admins may override any confirmed due date without restriction.
 */
export class DueDateConfirmationService {
  /**
   * Compute a system-estimated due date based on effort class.
   * Uses working days (Mon–Fri). Does not account for public holidays.
   *
   * @param from - Reference date (defaults to today)
   */
  estimateDueDate(effortClass: EffortClass, from?: Date): Date {
    const days = EFFORT_CLASS_DAYS[effortClass];
    return this.addWorkingDays(from ?? new Date(), days);
  }

  /**
   * Update the effort class on a request and recalculate the system estimate.
   * Does NOT confirm the due date — staff must confirm separately.
   */
  async updateEffortClass(
    requestId: string,
    effortClass: EffortClass
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    const newEstimate = this.estimateDueDate(effortClass);

    await clipRequestRepository.updateStaffFields(requestId, {
      effortClass,
    });

    // Update the internal system estimate (never shown directly to requester)
    const updated = await clipRequestRepository.updateStatus(requestId, request.status, {
      estimatedDueDate: newEstimate,
      // Reset confirmed state if effort changes significantly
      dueDateConfirmed: false,
      confirmedDueDate: null,
    });

    return updated;
  }

  /**
   * Confirm the due date for a request.
   *
   * Staff may confirm the system estimate or provide a custom date.
   * Once confirmed, the requester sees the date on their dashboard.
   *
   * @param confirmedDate - The date staff is committing to. Must be in the future.
   */
  async confirmDueDate(
    requestId: string,
    confirmedDate: Date,
    note?: string
  ): Promise<ClipRequest> {
    const request = await clipRequestRepository.findById(requestId);
    if (!request) throw new Error(`Request not found: ${requestId}`);

    const allowedStatuses = new Set([
      RequestStatus.UnderReview,
      RequestStatus.AcceptedForProduction,
      RequestStatus.Editing,
    ]);

    if (!allowedStatuses.has(request.status)) {
      throw new Error(
        `Cannot confirm due date for a request in status: ${request.status}`
      );
    }

    if (isNaN(confirmedDate.getTime())) {
      throw new Error("Invalid confirmed due date provided.");
    }

    const updated = await clipRequestRepository.updateStatus(
      requestId,
      request.status,
      {
        confirmedDueDate: confirmedDate,
        dueDateConfirmed: true,
      }
    );

    if (note?.trim()) {
      await requestStatusHistoryRepository.create({
        requestId,
        status: request.status,
        note: `Due date confirmed: ${this.formatDate(confirmedDate)}. ${note.trim()}`,
        changedAt: new Date(),
      });
    }

    return updated;
  }

  /**
   * Get due date status info for display in staff portal.
   */
  getDueDateStatus(request: ClipRequest): {
    systemEstimate: Date | null;
    confirmedDate: Date | null;
    isConfirmed: boolean;
    isOverdue: boolean;
    daysRemaining: number | null;
    formattedEstimate: string | null;
    formattedConfirmed: string | null;
  } {
    const now = new Date();
    const confirmedDate = request.confirmedDueDate;
    const systemEstimate = request.estimatedDueDate;
    const isOverdue = !!confirmedDate && confirmedDate < now;

    let daysRemaining: number | null = null;
    if (confirmedDate && !isOverdue) {
      const diff = confirmedDate.getTime() - now.getTime();
      daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    return {
      systemEstimate,
      confirmedDate,
      isConfirmed: request.dueDateConfirmed,
      isOverdue,
      daysRemaining,
      formattedEstimate: systemEstimate ? this.formatDate(systemEstimate) : null,
      formattedConfirmed: confirmedDate ? this.formatDate(confirmedDate) : null,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private addWorkingDays(from: Date, days: number): Date {
    const result = new Date(from);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const day = result.getDay();
      if (day !== 0 && day !== 6) {
        // Skip Saturday (6) and Sunday (0)
        added++;
      }
    }
    return result;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
}

// Singleton instance
export const dueDateConfirmationService = new DueDateConfirmationService();
