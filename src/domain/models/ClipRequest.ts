import { RequestStatus } from "@/domain/enums/RequestStatus";
import { Platform } from "@/domain/enums/Platform";
import { EffortClass } from "@/domain/enums/EffortClass";
import { EditorType } from "@/domain/enums/EditorType";

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
  /** Requester-provided authoritative business/place name. */
  placeName?: string;
  /** User-confirmed WGS84 coordinate selected on the request map. */
  latitude?: number;
  longitude?: number;
  description: string;
  targetAudience: string;
  targetPlatforms: Platform[];
  preferredStyle: string;
  preferredLanguage: string;
  durationSeconds: number;

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

  // ── Marketplace fields ─────────────────────────────────────────────────────

  /** EditorProfile.id of the selected editor (AI or human). Set at checkout. */
  assignedEditorId: string | null;

  /** Whether this request is routed to the AI pipeline or a human editor. */
  editorType: EditorType | null;

  /** Base price in ฿ shown on the editor card at the time of booking. */
  priceBaht: number;

  /** Number of credits applied as a discount at checkout (1 credit = ฿10 off). */
  creditsUsed: number;

  /** ฿ discount amount (creditsUsed × CREDIT_TO_BAHT_VALUE). */
  discountBaht: number;

  /** Actual ฿ charged after discount (priceBaht - discountBaht). */
  amountPaidBaht: number;

  /** Number of revision requests the requester has made after delivery. */
  revisionCount: number;

  // ── Trial / pay-to-download entitlement ────────────────────────────────────

  /**
   * True when the requester is entitled to download the clean (non-watermarked)
   * final master for this request.
   *
   * Trial model:
   * - A user's FIRST request generates for free but is `downloadUnlocked = false`
   *   (preview only). Paying the request price unlocks it.
   * - Every subsequent request is charged at submission, so it is created
   *   `downloadUnlocked = true`.
   *
   * Defaults to false. Persisted as `download_unlocked BOOLEAN NOT NULL DEFAULT false`.
   * Optional in the type only so legacy object literals compile; repositories
   * always populate it. Read it as `!!request.downloadUnlocked`.
   */
  downloadUnlocked?: boolean;

  /**
   * True when this request was the user's free trial (first) request — i.e. it
   * was NOT charged at submission. Used to decide the paywall copy and to know an
   * unlock payment is still owed. Defaults to false. Optional in the type only so
   * legacy object literals compile; repositories always populate it.
   */
  isTrialRequest?: boolean;

  // Timestamps
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  // ── Staff/Editor-only fields ───────────────────────────────────────────────

  /**
   * Staff-assigned effort classification.
   * TODO: PostgreSQL — `effort_class` TEXT NULLABLE on clip_requests table.
   */
  effortClass?: EffortClass | null;

  /**
   * @deprecated Use assignedEditorId instead.
   * Kept for backward compatibility with existing staff workflow services.
   */
  assignedStaffId?: string | null;
}

/** Input for creating a new draft request. */
export type CreateClipRequestInput = {
  userId: string;
  title: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
  description: string;
  targetAudience: string;
  targetPlatforms: Platform[];
  preferredStyle: string;
  preferredLanguage: string;
  durationSeconds: number;
};

/** Input for updating a draft before submission. */
export type UpdateClipRequestInput = Partial<
  Pick<
    ClipRequest,
    | "title"
    | "placeName"
    | "latitude"
    | "longitude"
    | "description"
    | "targetAudience"
    | "targetPlatforms"
    | "preferredStyle"
    | "preferredLanguage"
    | "durationSeconds"
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
