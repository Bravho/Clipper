/**
 * Clip request lifecycle statuses.
 *
 * Business rules:
 * - Draft:                  Requester is filling out the form. Not yet submitted.
 * - Submitted:              Requester has submitted. Awaiting staff review.
 * - UnderReview:            Staff is reviewing the submitted materials.
 * - AcceptedForProduction:  Staff accepted the request. Production is queued.
 * - Editing:                Staff is actively editing the clip.
 * - ScheduledForPublishing: Clip editing complete. Publishing is queued.
 * - Published:              Clip has been published to at least one channel.
 * - Delivered:              Delivery confirmed to requester.
 * - OnHold:                 Request paused (reason shown to requester).
 * - Rejected:               Request rejected (reason shown to requester).
 *
 * NOTE: No "InternalQA" status per product spec.
 *
 * TODO: PostgreSQL — store as TEXT with a CHECK constraint on the allowed values.
 *       Map to `status` column on the `clip_requests` table.
 */
export enum RequestStatus {
  Draft = "draft",
  Submitted = "submitted",
  UnderReview = "under_review",
  AcceptedForProduction = "accepted_for_production",
  Editing = "editing",
  ScheduledForPublishing = "scheduled_for_publishing",
  Published = "published",
  Delivered = "delivered",
  OnHold = "on_hold",
  Rejected = "rejected",
}

/** Statuses where the request is actively progressing (not terminal, not draft). */
export const ACTIVE_STATUSES: RequestStatus[] = [
  RequestStatus.Submitted,
  RequestStatus.UnderReview,
  RequestStatus.AcceptedForProduction,
  RequestStatus.Editing,
  RequestStatus.ScheduledForPublishing,
];

/** Terminal statuses — no further staff action expected. */
export const TERMINAL_STATUSES: RequestStatus[] = [
  RequestStatus.Published,
  RequestStatus.Delivered,
  RequestStatus.Rejected,
];
