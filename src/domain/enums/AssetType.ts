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
  /** Final edited clip uploaded by staff — stored in clips/ folder. */
  EditedClip = "edited_clip",

  // ── AI Pipeline asset types ─────────────────────────────────────────────────
  /** Raw 15s video produced by Kling AI from requester images. */
  AIGeneratedBaseVideo = "ai_generated_base_video",
  /** RVC-converted voice audio uploaded by staff (conversion happens in browser before upload). */
  StaffVoiceRecording = "staff_voice_recording",
  /** Alias kept for DB compatibility — points to the same asset as StaffVoiceRecording. */
  ProcessedVoice = "processed_voice",
  /** FFmpeg-composed final clip (one record per exported ratio). */
  FinalClip = "final_clip",
  /** Base video with Claude-generated animation/graphic overlays applied by FFmpeg. */
  AnimatedVideo = "animated_video",
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

/** Maximum overall upload size accepted by the upload service: 500 MB */
export const MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;
