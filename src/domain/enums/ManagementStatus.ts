/**
 * Status vocabularies for RClipper Management.
 *
 * Naming follows the existing repository convention: snake_case string values
 * stored verbatim in Postgres TEXT columns and guarded by CHECK constraints in
 * migration 019.
 */

/** How a content item got into Management. Both routes are free. */
export enum ManagementSourceType {
  /** Transferred from a completed RClipper generation project. */
  RClipperGeneration = "rclipper_generation",
  /** Uploaded directly by the user. */
  UserUpload = "user_upload",
}

/** Lifecycle of a purchased access pass. Nothing here auto-renews. */
export enum ManagementAccessPassStatus {
  /** Created but not yet paid for. Only ever transient. */
  Pending = "pending",
  /** Paid and inside its window — unlimited publishing. */
  Active = "active",
  /** Window elapsed. Content and history stay readable; new publishing stops. */
  Expired = "expired",
  /** Withdrawn by an administrator, with a recorded reason. */
  Revoked = "revoked",
  /** The credits were returned to the user. */
  Refunded = "refunded",
}

/**
 * Lifecycle of a single-video publish unlock.
 *
 * There is no "consumed" state: the unlock is PERMANENT. Publishing again,
 * adding a channel later, or retrying a failed send never uses it up.
 */
export enum ManagementPublishEntitlementStatus {
  Paid = "paid",
  Refunded = "refunded",
  Revoked = "revoked",
}

/**
 * Lifecycle of a purchased upload bundle (the entry product).
 *
 * A bundle is a CONSUMABLE, EXPIRING allowance of upload tokens. `remaining` is
 * decremented as tokens are spent; the row moves to `expired` once its window
 * lapses (housekeeping only — spendability is decided by comparing timestamps
 * and `remaining`, so a bundle is correct even if the sweep has never run).
 */
export enum ManagementUploadBundleStatus {
  /** Inside its window with tokens left, or awaiting the expiry sweep. */
  Active = "active",
  /** Window elapsed. Any unspent tokens are forfeit. */
  Expired = "expired",
  /** The credits were returned to the user. */
  Refunded = "refunded",
  /** Withdrawn by an administrator. */
  Revoked = "revoked",
}

/** Lifecycle of a content item. */
export enum ManagementContentStatus {
  /** Upload in progress; media not yet complete. */
  Uploading = "uploading",
  /** Media present and publishable. */
  Ready = "ready",
  Draft = "draft",
  Scheduled = "scheduled",
  Publishing = "publishing",
  PartiallyPublished = "partially_published",
  Published = "published",
  Failed = "failed",
  /**
   * The stored video passed its retention window and was purged. The RECORD,
   * its publishing history and any paid unlock all survive — the user may
   * upload a replacement into this same item at no further cost.
   */
  MediaExpired = "media_expired",
  Cancelled = "cancelled",
}

/** Aggregated status of a publication across all of its destinations. */
export enum ManagementPublicationStatus {
  Draft = "draft",
  Scheduled = "scheduled",
  Publishing = "publishing",
  PartiallyPublished = "partially_published",
  Published = "published",
  Failed = "failed",
  Cancelled = "cancelled",
}

/** Status of one destination within a publication. */
export enum ManagementPublicationTargetStatus {
  Draft = "draft",
  Scheduled = "scheduled",
  Publishing = "publishing",
  Published = "published",
  Failed = "failed",
  Cancelled = "cancelled",
}

/** Whether a publication goes out now or at a stored UTC instant. */
export enum ManagementPublishMode {
  PublishNow = "publish_now",
  Scheduled = "scheduled",
}

/** Connection state of a linked social account. */
export enum SocialConnectionStatus {
  /** Auth URL issued, user has not completed the flow yet. */
  Pending = "pending",
  Connected = "connected",
  /** Provider reports the account is no longer usable — needs reconnecting. */
  Disconnected = "disconnected",
  /** Removed by the user. */
  Removed = "removed",
}

/** What authorised a publication. Snapshotted when the publication is created. */
export enum ManagementEntitlementType {
  SingleVideo = "single_video",
  ThreeMonths = "three_months",
  SixMonths = "six_months",
  OneYear = "one_year",
  None = "none",
}

/** Async work states for the management job table. */
export enum ManagementJobState {
  Queued = "queued",
  Claimed = "claimed",
  Done = "done",
  Failed = "failed",
}

/** Kinds of async work. */
export enum ManagementJobKind {
  CreatePublication = "create_publication",
  ReconcilePublication = "reconcile_publication",
  RefreshSocialAccount = "refresh_social_account",
  ProcessProviderWebhook = "process_provider_webhook",
  ExpireContentMedia = "expire_content_media",
  /** Promote a paying user's uploads from the 7-day prefix to the 30-day one. */
  ExtendUploadRetention = "extend_upload_retention",
}
