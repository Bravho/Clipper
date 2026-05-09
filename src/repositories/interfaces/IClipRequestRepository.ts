import {
  ClipRequest,
  CreateClipRequestInput,
  UpdateClipRequestInput,
  UpdateStaffFieldsInput,
} from "@/domain/models/ClipRequest";
import { RequestStatus } from "@/domain/enums/RequestStatus";

/**
 * Repository contract for ClipRequest persistence.
 *
 * TODO: PostgreSQL — implement PostgresClipRequestRepository.
 *   Use transactions when updating status + logging status history together.
 *   Consider SELECT FOR UPDATE when updating status to prevent race conditions.
 *   Index: (user_id, status) for efficient dashboard queries.
 *   Index: (status) for staff queue queries.
 *   Index: (status, submitted_at) for staff review queue (oldest first).
 */
export interface IClipRequestRepository {
  // ── Requester queries ───────────────────────────────────────────────────────
  findById(id: string): Promise<ClipRequest | null>;
  findByUserId(userId: string): Promise<ClipRequest[]>;
  findByUserIdAndStatus(
    userId: string,
    statuses: RequestStatus[]
  ): Promise<ClipRequest[]>;

  // ── Editor queries ──────────────────────────────────────────────────────────
  /** All requests assigned to a specific editor. */
  findByEditorId(editorId: string): Promise<ClipRequest[]>;
  /** Requests assigned to an editor filtered by status. */
  findByEditorIdAndStatus(editorId: string, statuses: RequestStatus[]): Promise<ClipRequest[]>;

  // ── Staff queries ───────────────────────────────────────────────────────────
  /**
   * Find all requests with any of the given statuses.
   * Used by staff queue pages to load work items across all requesters.
   *
   * TODO: PostgreSQL — implement as:
   *   SELECT * FROM clip_requests WHERE status = ANY($1) ORDER BY submitted_at ASC
   */
  findByStatus(statuses: RequestStatus[]): Promise<ClipRequest[]>;

  /**
   * Find all requests across the system (staff overview).
   * TODO: PostgreSQL — SELECT * FROM clip_requests ORDER BY updated_at DESC LIMIT $1
   */
  findAll(limit?: number): Promise<ClipRequest[]>;

  /**
   * Count requests grouped by status.
   * Used by staff dashboard for summary cards.
   * TODO: PostgreSQL — SELECT status, COUNT(*) FROM clip_requests GROUP BY status
   */
  countByStatus(): Promise<Partial<Record<RequestStatus, number>>>;

  /**
   * Find requests where confirmedDueDate is in the past and status is still active.
   * Used for at-risk / overdue indicators.
   * TODO: PostgreSQL:
   *   SELECT * FROM clip_requests
   *   WHERE confirmed_due_date < NOW()
   *   AND status NOT IN ('delivered','rejected','on_hold','draft')
   */
  findOverdue(): Promise<ClipRequest[]>;

  /**
   * Find requests that are accepted/editing but have no confirmed due date yet.
   * Used by the due-date confirmation queue.
   * TODO: PostgreSQL:
   *   SELECT * FROM clip_requests
   *   WHERE status IN ('accepted_for_production','editing')
   *   AND due_date_confirmed = false
   */
  findPendingDueDateConfirmation(): Promise<ClipRequest[]>;

  // ── Mutations ───────────────────────────────────────────────────────────────
  create(input: CreateClipRequestInput): Promise<ClipRequest>;
  update(id: string, input: UpdateClipRequestInput): Promise<ClipRequest>;

  /**
   * Update staff-specific fields (effort class, CapCut ref, progress notes, etc.).
   * This is separate from the requester-facing update to keep concerns clear.
   */
  updateStaffFields(
    id: string,
    input: UpdateStaffFieldsInput
  ): Promise<ClipRequest>;

  updateStatus(
    id: string,
    status: RequestStatus,
    extra?: Partial<
      Pick<
        ClipRequest,
        | "holdReason"
        | "rejectionReason"
        | "confirmedDueDate"
        | "dueDateConfirmed"
        | "estimatedDueDate"
        | "queuePosition"
        | "submittedAt"
        | "creditConfirmed"
        | "rightsConfirmed"
        | "assignedStaffId"
        | "assignedEditorId"
        | "editorType"
        | "priceBaht"
        | "creditsUsed"
        | "discountBaht"
        | "amountPaidBaht"
        | "revisionCount"
      >
    >
  ): Promise<ClipRequest>;

  delete(id: string): Promise<void>;
}
