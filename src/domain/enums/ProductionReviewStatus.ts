/**
 * Admin production review status.
 *
 * When staff submit a completed clip for admin review
 * (Editing → ScheduledForPublishing), a ProductionReview record is created
 * with status Pending. Admin then acts on it.
 *
 * This status is internal — it never surfaces directly to requesters.
 * The requester-facing status remains the canonical RequestStatus.
 *
 * TODO: PostgreSQL — store as TEXT CHECK constraint on production_reviews table.
 */
export enum ProductionReviewStatus {
  Pending = "pending",
  Approved = "approved",
  ReturnedToEditing = "returned_to_editing",
  OnHold = "on_hold",
  Rejected = "rejected",
}

export const PRODUCTION_REVIEW_STATUS_LABELS: Record<ProductionReviewStatus, string> = {
  [ProductionReviewStatus.Pending]: "Pending Review",
  [ProductionReviewStatus.Approved]: "Approved",
  [ProductionReviewStatus.ReturnedToEditing]: "Returned to Editing",
  [ProductionReviewStatus.OnHold]: "Review On Hold",
  [ProductionReviewStatus.Rejected]: "Rejected",
};
