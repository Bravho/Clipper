import { ProductionReviewStatus } from "@/domain/enums/ProductionReviewStatus";

/**
 * ProductionReview — internal admin review record for clips submitted from editing.
 *
 * When staff submit a clip for admin review (Editing → ScheduledForPublishing),
 * a ProductionReview record is created to track the admin approval workflow.
 *
 * This model is NEVER exposed to requesters. The requester only sees the
 * canonical RequestStatus (ScheduledForPublishing → Published etc.).
 *
 * A single request can have multiple ProductionReview records over its lifetime
 * if it is returned to editing and resubmitted. Only the latest record is active.
 *
 * TODO: PostgreSQL — map to `production_reviews` table.
 *   Columns: id TEXT PK, request_id TEXT FK → clip_requests.id,
 *   status TEXT CHECK, reviewed_by TEXT FK → users.id (nullable),
 *   review_note TEXT (nullable), submitted_at TIMESTAMPTZ,
 *   reviewed_at TIMESTAMPTZ (nullable), created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ.
 *   Indexes: (request_id), (status), (status, created_at DESC).
 */
export interface ProductionReview {
  id: string;
  requestId: string;

  /** Current admin review decision. */
  status: ProductionReviewStatus;

  /** User ID of the admin who acted on this review. Null until reviewed. */
  reviewedBy: string | null;

  /** Internal review note from admin. NEVER shown to requester. */
  reviewNote: string | null;

  /** Timestamp when staff submitted the clip for admin review. */
  submittedAt: Date;

  /** Timestamp when admin last acted on this review. Null if still pending. */
  reviewedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

/** Input when creating a new production review record (staff submits for review). */
export type CreateProductionReviewInput = {
  requestId: string;
  submittedAt: Date;
};

/** Input when admin acts on a production review. */
export type UpdateProductionReviewInput = {
  status: ProductionReviewStatus;
  reviewedBy: string;
  reviewNote?: string;
};
