/**
 * Type of a requester-uploaded source asset.
 *
 * Requesters may upload up to 5 videos or images as source material
 * for their clip request. These are NOT a reusable asset library —
 * they are retained for the submitted request only and deleted after 90 days.
 *
 * TODO: PostgreSQL — store as TEXT with CHECK constraint on `uploaded_assets` table.
 */
export enum AssetType {
  Video = "video",
  Image = "image",
}

/** Upload status of a single asset record. */
export enum AssetUploadStatus {
  Pending = "pending",     // Selected by requester, not yet sent
  Uploading = "uploading", // Upload in progress
  Uploaded = "uploaded",   // Successfully stored
  Failed = "failed",       // Upload error — retryable
  Deleted = "deleted",     // Removed per 90-day retention policy
}

/** Accepted MIME types for video uploads. */
export const ACCEPTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",  // .mov
  "video/x-msvideo",  // .avi
  "video/webm",
] as const;

/** Accepted MIME types for image uploads. */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const ACCEPTED_MIME_TYPES = [
  ...ACCEPTED_VIDEO_MIME_TYPES,
  ...ACCEPTED_IMAGE_MIME_TYPES,
] as const;

/** Maximum number of files a requester may attach to a single request. */
export const MAX_UPLOAD_COUNT = 5;

/** Maximum file size for image uploads: 8 MB */
export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

/** Maximum file size for video uploads: 80 MB */
export const MAX_VIDEO_SIZE_BYTES = 80 * 1024 * 1024;
