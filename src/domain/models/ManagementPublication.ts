import {
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
  ManagementPublishMode,
} from "@/domain/enums/ManagementStatus";

/**
 * A publish action for one content item, fanned out to one or more connected
 * social accounts.
 *
 * PostgreSQL → `management_publications`.
 *
 * The parent status is DERIVED from its targets (see aggregatePublicationStatus)
 * and never set independently — a single platform succeeding must not mark the
 * whole publication published, and a single platform failing must not mark it
 * failed.
 */
export interface ManagementPublication {
  id: string;
  userId: string;
  managementContentId: string;
  publishMode: ManagementPublishMode;
  /** UTC instant. Null for publish_now. */
  scheduledAt: Date | null;
  /** IANA zone the user chose the time in, e.g. "Asia/Bangkok". Display only. */
  timezone: string | null;
  status: ManagementPublicationStatus;
  /** Provider's parent post id, once created. */
  providerPostId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One destination of a publication — exactly one per selected social account.
 *
 * PostgreSQL → `management_publication_targets`.
 *
 * Target rows are created BEFORE the provider is called, so a crash mid-send
 * leaves an auditable record that reconciliation and retry can act on, and so
 * partial success is representable rather than collapsing to a single verdict.
 */
export interface ManagementPublicationTarget {
  id: string;
  publicationId: string;
  socialConnectionId: string;
  platform: string;
  /** Platform-specific copy, seeded from the generated post kit then edited. */
  caption: string;
  title: string | null;
  description: string | null;
  hashtags: string[];
  /** Which content asset (video variant) is being published here. */
  managementContentAssetId: string | null;
  /**
   * The upload-token bundle that paid for this target, when publishing was
   * token-based. Null when an access pass authorised it (a pass spends no token)
   * or the target has not yet been charged.
   */
  uploadBundleId: string | null;
  providerPostId: string | null;
  /** Provider's per-destination result id. */
  providerResultId: string | null;
  status: ManagementPublicationTargetStatus;
  /** Classified, non-raw error code. Provider payloads are never shown to users. */
  errorCode: string | null;
  errorMessage: string | null;
  publishedUrl: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  providerMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating one destination of a publication.
 *
 * The composer resolves, per selected channel, WHICH connected account and
 * WHICH video variant to publish — so both ids are explicit. Caption/title/etc.
 * are seeded from the generated post kit then edited; an absent field falls back
 * to the publication-level caption at send time.
 */
export interface CreatePublicationTargetInput {
  socialConnectionId: string;
  /** The video variant (content asset) to publish to this destination. */
  managementContentAssetId: string;
  caption?: string;
  title?: string | null;
  description?: string | null;
  hashtags?: string[];
}

/**
 * Input for creating a publication and all of its targets in one transaction.
 *
 * The entitlement snapshot is written here, at creation, and never re-checked
 * when the post fires — a post scheduled while a pass was live still goes out
 * after the pass lapses.
 */
export interface CreatePublicationInput {
  userId: string;
  managementContentId: string;
  publishMode: ManagementPublishMode;
  /** UTC instant. Null for publish_now. */
  scheduledAt: Date | null;
  timezone: string | null;
  entitlementType: string;
  accessPassId: string | null;
  publishEntitlementId: string | null;
  targets: {
    socialConnectionId: string;
    platform: string;
    caption: string;
    title: string | null;
    description: string | null;
    hashtags: string[];
    managementContentAssetId: string | null;
    scheduledAt: Date | null;
  }[];
}

/** Mutable fields on a target, written as the provider result comes back. */
export interface UpdatePublicationTargetFields {
  status?: ManagementPublicationTargetStatus;
  providerPostId?: string | null;
  providerResultId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  publishedUrl?: string | null;
  publishedAt?: Date | null;
  scheduledAt?: Date | null;
  providerMetadata?: Record<string, unknown> | null;
  /**
   * Editable post copy. Written only when a user edits a still-scheduled post
   * (a live post cannot be changed via the provider), so these are normally left
   * untouched as a publication moves through its lifecycle.
   */
  caption?: string;
  title?: string | null;
  description?: string | null;
  hashtags?: string[];
}

/** A publication together with its destinations. */
export interface PublicationWithTargets {
  publication: ManagementPublication;
  targets: ManagementPublicationTarget[];
}

/**
 * Derive the parent status from its destinations.
 *
 * Rules (in evaluation order):
 *   no targets                                   -> draft
 *   every target cancelled                       -> cancelled
 *   any target publishing                        -> publishing
 *   some succeeded and others still pending      -> publishing
 *   some succeeded and at least one failed        -> partially_published
 *   every target succeeded                       -> published
 *   every target terminally failed, none succeeded -> failed
 *   every target scheduled                       -> scheduled
 *   otherwise                                    -> draft
 *
 * Per-destination detail is never discarded — this only computes the rollup.
 */
export function aggregatePublicationStatus(
  targets: Pick<ManagementPublicationTarget, "status">[]
): ManagementPublicationStatus {
  if (targets.length === 0) return ManagementPublicationStatus.Draft;

  const count = (s: ManagementPublicationTargetStatus) =>
    targets.filter((t) => t.status === s).length;

  const total = targets.length;
  const cancelled = count(ManagementPublicationTargetStatus.Cancelled);
  const published = count(ManagementPublicationTargetStatus.Published);
  const failed = count(ManagementPublicationTargetStatus.Failed);
  const publishing = count(ManagementPublicationTargetStatus.Publishing);
  const scheduled = count(ManagementPublicationTargetStatus.Scheduled);
  const draft = count(ManagementPublicationTargetStatus.Draft);

  if (cancelled === total) return ManagementPublicationStatus.Cancelled;

  // Cancelled destinations are excluded from the success/failure maths so that
  // cancelling one platform cannot flip the whole publication to "failed".
  const live = total - cancelled;
  if (live === 0) return ManagementPublicationStatus.Cancelled;

  if (publishing > 0) return ManagementPublicationStatus.Publishing;

  // Something succeeded but work remains -> still publishing, not partial.
  if (published > 0 && published + failed < live) {
    return ManagementPublicationStatus.Publishing;
  }

  if (published > 0 && failed > 0) return ManagementPublicationStatus.PartiallyPublished;
  if (published === live) return ManagementPublicationStatus.Published;
  if (failed === live) return ManagementPublicationStatus.Failed;
  if (scheduled === live) return ManagementPublicationStatus.Scheduled;
  if (draft === live) return ManagementPublicationStatus.Draft;

  return ManagementPublicationStatus.Draft;
}
