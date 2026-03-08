import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";

/**
 * Metadata record for a file uploaded by a requester.
 *
 * Important policy rules:
 * - Uploaded source files are NOT a reusable asset library.
 * - Each asset is tied to exactly one clip request.
 * - Raw uploads are scheduled for deletion 90 days after upload (scheduledDeletionAt).
 * - Actual file bytes are stored externally (DigitalOcean Spaces).
 *   The `storageKey` is the DO Spaces object key.
 *   The `storageUrl` is a public or presigned URL for display/download.
 *
 * TODO: PostgreSQL — map to `uploaded_assets` table.
 *   Columns: id, request_id (FK), user_id, file_name, asset_type, file_size_bytes,
 *            mime_type, storage_key, storage_url, upload_status, scheduled_deletion_at,
 *            created_at, updated_at
 *
 * TODO: DigitalOcean Spaces — replace storageKey/storageUrl with real values from
 *   the presigned upload flow. The UploadService will generate presigned PUT URLs
 *   and set the storage key on confirmation.
 */
export interface UploadedAsset {
  id: string;
  requestId: string;
  userId: string;

  // File metadata
  fileName: string;
  assetType: AssetType;
  fileSizeBytes: number;
  mimeType: string;

  // Storage
  /** Object key in DigitalOcean Spaces. Set to the tmp/ key on creation; updated to request_mat/ key on confirmation. */
  storageKey: string;
  /** Public URL for the stored object. Empty string until upload is confirmed. */
  storageUrl: string;

  // Thumbnail (generated after upload confirmation)
  /** Storage key of the thumbnail image in DO Spaces (thumbnails/ folder). Empty string until generated. */
  thumbnailKey: string;
  /** Public URL of the thumbnail image. Empty string until generated. */
  thumbnailUrl: string;

  // Upload lifecycle
  uploadStatus: AssetUploadStatus;

  /** Date when this raw upload will be deleted per the 90-day retention policy. */
  scheduledDeletionAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type CreateUploadedAssetInput = Omit<
  UploadedAsset,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateUploadedAssetInput = Partial<
  Pick<UploadedAsset, "storageKey" | "storageUrl" | "thumbnailKey" | "thumbnailUrl" | "uploadStatus">
>;
