import {
  ManagementContentStatus,
  ManagementSourceType,
} from "@/domain/enums/ManagementStatus";

/**
 * A video held in RClipper Management.
 *
 * PostgreSQL → `management_content_items`.
 *
 * TWO SOURCES, BOTH FREE:
 *   * `rclipper_generation` — transferred from a completed generation project.
 *     `sourceGenerationId` names the clip request. One live item per project.
 *   * `user_upload` — the user's own file. `sourceGenerationId` is null, and a
 *     user may hold as many uploads as they like. This is what lets Management
 *     stand on its own as a multi-channel publish-and-manage tool rather than
 *     only an extension of the generator.
 *
 * Getting content here costs nothing. Payment is required only to PUBLISH.
 *
 * MEDIA vs RECORD. The stored video is kept until `mediaExpiresAt` and then
 * purged; this record, its publishing history and any paid unlock are kept
 * indefinitely. After a purge the status becomes `media_expired` and the user
 * may upload a replacement into this same item at no further cost.
 *
 * Content is NEVER deleted because an access pass expired.
 */
export interface ManagementContentItem {
  id: string;
  userId: string;
  sourceType: ManagementSourceType;
  /** clip_requests.id for a transfer; null for an upload. */
  sourceGenerationId: string | null;
  /**
   * The specific generated export (uploaded_assets.id) this item represents,
   * so one project can be transferred as several independent per-video items.
   * Null for an upload and for any legacy whole-project transfer.
   */
  sourceAssetId: string | null;
  title: string;
  description: string | null;
  /**
   * A per-video default caption and hashtag set, edited on the video card and
   * pre-filled into every channel at publish time. Seeded from the generation
   * post kit for a transferred video; blank for a user upload.
   */
  defaultCaption: string | null;
  defaultHashtags: string[];
  /** Stable Spaces key, not a signed URL — signed URLs are derived on read. */
  thumbnailStorageKey: string | null;
  status: ManagementContentStatus;
  /**
   * Soft delete. Non-null means the user removed the video from their library;
   * the record and publishing history are kept and the stored file is left for
   * its Space lifecycle rule to purge. `removedAt !== null` is the "Removed"
   * state, deliberately separate from `status`.
   */
  removedAt: Date | null;
  /**
   * When the stored video is due to be purged. Null means "not yet scheduled"
   * (an upload still in progress). Held past this date while a scheduled
   * publication still needs the file.
   */
  mediaExpiresAt: Date | null;
  /** Set once the media has actually been purged. */
  mediaDeletedAt: Date | null;
  transferredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One publishable video variant belonging to a content item.
 *
 * PostgreSQL → `management_content_assets`.
 *
 * A transferred variant points at the generated `uploaded_assets` row — media is
 * REFERENCED, never duplicated. A user-uploaded video has no clip request and
 * therefore no `uploaded_assets` row, so `sourceVideoId` is null and
 * `storageKey` is the identity.
 *
 * Either way this stores the STABLE key, never a signed URL: those expire in an
 * hour and a scheduled post may publish weeks later, so the publish job mints a
 * fresh one at send time.
 */
export interface ManagementContentAsset {
  id: string;
  managementContentId: string;
  /** uploaded_assets.id for a transferred variant; null for an upload. */
  sourceVideoId: string | null;
  /** Which channel/ratio this variant serves, e.g. "9:16" or "original". */
  platformVariant: string;
  storageKey: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  aspectRatio: string | null;
  originalFilename: string | null;
  fileSizeBytes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A generation channel carried into Channel Management as a recommendation.
 *
 * Suggestions are snapshots, not publication targets: they preserve the
 * requester's distribution choice and that channel's final edited post copy,
 * but the user must still explicitly choose a connected account before any
 * publication is created.
 */
export interface ManagementChannelSuggestion {
  id: string;
  managementContentId: string;
  /** Generator platform value (currently tiktok/facebook/instagram/youtube). */
  platform: string;
  /** Preserves the primary-first order from ClipRequest.targetPlatforms. */
  displayOrder: number;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  locale: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** True when the item still has media a publication could use. */
export function hasUsableMedia(item: ManagementContentItem): boolean {
  return (
    item.mediaDeletedAt === null &&
    item.status !== ManagementContentStatus.MediaExpired &&
    item.status !== ManagementContentStatus.Cancelled &&
    item.status !== ManagementContentStatus.Uploading
  );
}
