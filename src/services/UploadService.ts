import {
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AssetType,
  AssetUploadStatus,
  MAX_UPLOAD_COUNT,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  ACCEPTED_VIDEO_MIME_TYPES,
} from "@/domain/enums/AssetType";
import { UploadedAsset } from "@/domain/models/UploadedAsset";
import { uploadedAssetRepository } from "@/repositories";
import { spacesClient, SPACES_BUCKET, spacesPublicUrl } from "@/lib/spaces";
import {
  buildTmpKey,
  buildRequestMatKey,
  buildThumbnailKey,
} from "@/lib/spacesKeys";
import { generateImageThumbnail } from "@/lib/thumbnails";

/**
 * UploadService — manages the full lifecycle of requester-uploaded source files.
 *
 * Upload flow (presigned URL):
 *
 *   1. Client calls POST /api/uploads/[requestId] with file metadata.
 *      → createPresignedUpload() generates a presigned PUT URL for the tmp/ folder
 *        and creates a Pending asset record.
 *      ← Returns { assetId, presignedUrl, storageKey }
 *
 *   2. Client PUTs the file DIRECTLY to DO Spaces using the presigned URL.
 *      → File lands at: tmp/{userId}/{YYYY-MM-DD}/{requestId}/{uuid}-{filename}
 *
 *   3. Client calls POST /api/uploads/[requestId]/confirm with { assetId }.
 *      → confirmUpload() copies the object from tmp/ to request_mat/,
 *        deletes the tmp/ object, reserves a thumbnail key, and marks the
 *        asset record as Uploaded.
 *      ← Returns the updated UploadedAsset.
 *
 * Thumbnail generation:
 *   A thumbnail key (thumbnails/ folder) is reserved on confirmation.
 *   Actual thumbnail generation (image resize / video frame extraction) is a
 *   background job — NOT handled in this service in Phase 1.
 *   TODO: Implement thumbnail generation worker (e.g. using sharp for images,
 *   ffmpeg for videos) that reads storageKey, generates a .jpg frame/resize,
 *   uploads to thumbnailKey, and calls updateThumbnail() below.
 *
 * Final clip upload (staff):
 *   Staff upload the finished clip to clips/{userId}/{date}/{requestId}/.
 *   TODO: Implement staff-side clip upload using buildClipKey() from spacesKeys.ts.
 *
 * Clip thumbnail (system):
 *   After the final clip is uploaded, a thumbnail is generated and stored
 *   in the thumbnails/ folder using buildThumbnailKey().
 *   TODO: Implement as part of the staff clip upload flow.
 */

export interface PresignedUploadResult {
  assetId: string;
  presignedUrl: string;
  storageKey: string;
}

export interface UploadValidationResult {
  valid: boolean;
  error?: string;
}

/** Presigned URL expiry in seconds (15 minutes). */
const PRESIGNED_URL_TTL = 15 * 60;

export class UploadService {
  /**
   * Validate file metadata before creating a presigned upload URL.
   */
  validateFile(
    file: { name: string; size: number; type: string },
    currentCount: number
  ): UploadValidationResult {
    if (currentCount >= MAX_UPLOAD_COUNT) {
      return {
        valid: false,
        error: `Maximum ${MAX_UPLOAD_COUNT} files allowed per request.`,
      };
    }

    const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
      file.type as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
    );
    const maxBytes = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
    const maxMB = maxBytes / (1024 * 1024);

    if (file.size > maxBytes) {
      return {
        valid: false,
        error: `File "${file.name}" exceeds the ${maxMB} MB limit.`,
      };
    }

    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      return {
        valid: false,
        error: `File "${file.name}" is not a supported video or image format.`,
      };
    }

    return { valid: true };
  }

  /**
   * Step 1 of the upload flow.
   *
   * Generates a presigned PUT URL for the tmp/ folder and creates a Pending
   * asset record. The client uses the presigned URL to upload directly to
   * DO Spaces without routing bytes through the Next.js server.
   */
  async createPresignedUpload(input: {
    requestId: string;
    userId: string;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  }): Promise<PresignedUploadResult> {
    const key = buildTmpKey(input.userId, input.requestId, input.fileName);

    const command = new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      ContentType: input.mimeType,
    });

    const presignedUrl = await getSignedUrl(spacesClient, command, {
      expiresIn: PRESIGNED_URL_TTL,
    });

    const isVideo = ACCEPTED_VIDEO_MIME_TYPES.includes(
      input.mimeType as (typeof ACCEPTED_VIDEO_MIME_TYPES)[number]
    );
    const assetType = isVideo ? AssetType.Video : AssetType.Image;

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + 90);

    const asset = await uploadedAssetRepository.create({
      requestId: input.requestId,
      userId: input.userId,
      fileName: input.fileName,
      assetType,
      fileSizeBytes: input.fileSizeBytes,
      mimeType: input.mimeType,
      storageKey: key,
      storageUrl: "",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Pending,
      scheduledDeletionAt,
    });

    return { assetId: asset.id, presignedUrl, storageKey: key };
  }

  /**
   * Step 3 of the upload flow.
   *
   * Called after the client has successfully PUT the file to the presigned URL.
   * - Copies the object from tmp/ to request_mat/
   * - Deletes the tmp/ object
   * - Reserves a thumbnail key in thumbnails/
   * - Marks the asset as Uploaded
   *
   * Thumbnail generation (image resize / video frame) must be handled separately
   * by a background worker — this method only reserves the key path.
   */
  async confirmUpload(assetId: string, userId: string): Promise<UploadedAsset> {
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Asset not found.");
    if (asset.userId !== userId) throw new Error("Access denied.");
    if (!asset.storageKey.startsWith("tmp/")) {
      throw new Error("Asset is not in pending (tmp) state.");
    }

    // Destination key in request_mat/
    const destKey = buildRequestMatKey(asset.userId, asset.requestId, asset.fileName);

    // Copy from tmp/ to request_mat/
    await spacesClient.send(
      new CopyObjectCommand({
        Bucket: SPACES_BUCKET,
        CopySource: `${SPACES_BUCKET}/${asset.storageKey}`,
        Key: destKey,
        ContentType: asset.mimeType,
      })
    );

    // Delete the tmp/ object
    await spacesClient.send(
      new DeleteObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: asset.storageKey,
      })
    );

    // Generate thumbnail — must be < 20 KB
    const baseName = asset.fileName.replace(/\.[^.]+$/, "");
    const thumbKey = buildThumbnailKey(asset.userId, asset.requestId, baseName);
    let thumbnailGenerated = false;

    if (asset.assetType === AssetType.Image) {
      // Generate immediately using sharp (resize + iterative quality reduction)
      await generateImageThumbnail(destKey, thumbKey);
      thumbnailGenerated = true;
    }
    // Video thumbnails require ffmpeg — key is reserved but generation is deferred.
    // TODO: Dispatch a background job here to call generateVideoThumbnail(destKey, thumbKey)
    //   and then call updateThumbnail(assetId, thumbKey) once done.

    return uploadedAssetRepository.update(assetId, {
      storageKey: destKey,
      storageUrl: spacesPublicUrl(destKey),
      thumbnailKey: thumbnailGenerated ? thumbKey : "",
      thumbnailUrl: thumbnailGenerated ? spacesPublicUrl(thumbKey) : "",
      uploadStatus: AssetUploadStatus.Uploaded,
    });
  }

  /**
   * Update the thumbnail URL once the background job has generated and
   * uploaded the thumbnail to DO Spaces.
   *
   * Called by the thumbnail generation worker after it uploads the .jpg to
   * the reserved thumbnailKey path.
   */
  async updateThumbnail(assetId: string, thumbnailKey: string): Promise<UploadedAsset> {
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Asset not found.");
    return uploadedAssetRepository.update(assetId, {
      thumbnailKey,
      thumbnailUrl: spacesPublicUrl(thumbnailKey),
    });
  }

  /** Get all assets for a request. */
  async getAssets(requestId: string): Promise<UploadedAsset[]> {
    return uploadedAssetRepository.findByRequestId(requestId);
  }

  /**
   * Remove a single asset: deletes from DO Spaces and marks the DB record as Deleted.
   */
  async removeAsset(assetId: string, userId: string): Promise<void> {
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Asset not found.");
    if (asset.userId !== userId) throw new Error("Access denied.");

    if (asset.storageKey) {
      await spacesClient.send(
        new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: asset.storageKey })
      );
    }

    await uploadedAssetRepository.update(assetId, {
      uploadStatus: AssetUploadStatus.Deleted,
    });
  }

  /**
   * Delete all assets for a request (used when deleting a draft).
   * Removes each object from DO Spaces then clears the DB records.
   */
  async deleteAssetsByRequestId(requestId: string): Promise<void> {
    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    await Promise.all(
      assets
        .filter((a) => a.storageKey)
        .map((a) =>
          spacesClient.send(
            new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: a.storageKey })
          )
        )
    );
    await uploadedAssetRepository.deleteByRequestId(requestId);
  }

  /** Count current uploads for a request (for the 5-file limit check). */
  async countAssets(requestId: string): Promise<number> {
    return uploadedAssetRepository.countByRequestId(requestId);
  }
}

// Singleton instance
export const uploadService = new UploadService();
