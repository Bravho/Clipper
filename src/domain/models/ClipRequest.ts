import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { EffortClass } from "@/domain/enums/EffortClass";

/**
 * Core clip request entity.
 *
 * A ClipRequest is created by a requester and progresses through the
 * production workflow managed by internal staff.
 *
 * Due date fields:
 * - estimatedDueDate:  Internal system/staff estimate. NEVER shown directly to requester.
 * - confirmedDueDate:  Staff-confirmed date. Shown to requester only when dueDateConfirmed = true.
 * - dueDateConfirmed:  Set true by staff when they confirm the date.
 *
 * Requester only sees confirmedDueDate after staff confirmation. Before that,
 * a "pending review" message is shown.
 *
 * TODO: PostgreSQL — map to `clip_requests` table.
 *   Column mapping:
 *     userId           → user_id (FK → users.id)
 *     targetPlatforms  → target_platforms TEXT[]
 *     holdReason       → hold_reason TEXT NULLABLE
 *     rejectionReason  → rejection_reason TEXT NULLABLE
 *     estimatedDueDate → estimated_due_date TIMESTAMPTZ NULLABLE
 *     confirmedDueDate → confirmed_due_date TIMESTAMPTZ NULLABLE
 *     dueDateConfirmed → due_date_confirmed BOOLEAN DEFAULT false
 *     queuePosition    → computed via query, not stored column
 *     creditsCost      → credits_cost INTEGER DEFAULT 10
 *     creditConfirmed  → credit_confirmed BOOLEAN DEFAULT false
 *     rightsConfirmed  → rights_confirmed BOOLEAN DEFAULT false
 *     submittedAt      → submitted_at TIMESTAMPTZ NULLABLE
 */
export interface ClipRequest {
  id: string;
  userId: string;

  // Brief fields
  title: string;
  description: string;
  targetAudience: string;
  targetPlatforms: Platform[];
  preferredStyle: string;
  preferredLanguage: string;

  // Status
  status: RequestStatus;

  // Due date — see notes above
  /** Internal system estimate. Never expose directly to requester. */
  estimatedDueDate: Date | null;
  /** Staff-confirmed date. Only shown to requester when dueDateConfirmed = true. */
  confirmedDueDate: Date | null;
  dueDateConfirmed: boolean;

  // Hold / Reject reasons (visible to requester)
  holdReason: string | null;
  rejectionReason: string | null;

  // Queue — simplified position indicator for requester display
  queuePosition: number | null;

  // Legal confirmations collected at submission
  creditConfirmed: boolean;
  rightsConfirmed: boolean;

  // Credits
  creditsCost: number;

  // Timestamps
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  // ── Staff-only fields (Phase 2C) ──────────────────────────────────────────
  // These fields are managed by staff and NEVER exposed directly to requesters.

  /**
   * Staff-assigned effort classification.
   * Set at acceptance. Used for due date estimation and capacity planning.
   * TODO: PostgreSQL — `effort_class` TEXT NULLABLE on clip_requests table.
   */
  effortClass?: EffortClass | null;

  /**
   * The staff member who accepted and owns this request.
   * Set when staff accepts (Submitted/Rejected → Editing).
   * Cleared when the request is rejected or resumed from hold.
   * While set, only the assigned staff (or admin) can perform workflow actions.
   * TODO: PostgreSQL — `assigned_staff_id` TEXT NULLABLE FK → users.id
   */
  assignedStaffId?: string | null;
}

/** Input for creating a new draft request. */
export type CreateClipRequestInput = {
  userId: string;
  title: string;
  description: string;
  targetAudience: string;
  targetPlatforms: Platform[];
  preferredStyle: string;
  preferredLanguage: string;
};

/** Input for updating a draft before submission. */
export type UpdateClipRequestInput = Partial<
  Pick<
    ClipRequest,
    | "title"
    | "description"
    | "targetAudience"
    | "targetPlatforms"
    | "preferredStyle"
    | "preferredLanguage"
  >
>;

/** Input collected at the point of submission (legal confirmations). */
export type SubmitClipRequestInput = {
  creditConfirmed: true;
  rightsConfirmed: true;
};

/**
 * Input for updating staff-specific fields on a request.
 * Only staff or admin may call this.
 */
export type UpdateStaffFieldsInput = Partial<Pick<ClipRequest, "effortClass">>;
