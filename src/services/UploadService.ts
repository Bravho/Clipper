import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  AssetType,
  AssetUploadStatus,
  MAX_UPLOAD_COUNT,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MAX_UPLOAD_SIZE_BYTES,
  ACCEPTED_VIDEO_MIME_TYPES,
} from "@/domain/enums/AssetType";
import { validateClipDuration, validateTotalUploadSize } from "@/features/requests/validation/clipRequestSchema";
import { UploadedAsset } from "@/domain/models/UploadedAsset";
import { uploadedAssetRepository } from "@/repositories";
import { spacesClient, SPACES_BUCKET, spacesPublicUrl } from "@/lib/spaces";
import {
  buildTmpKey,
  buildRequestMatKey,
  buildThumbnailKey,
} from "@/lib/spacesKeys";
import { generateImageThumbnail, generateVideoThumbnail, storePosterThumbnail } from "@/lib/thumbnails";
import { AI_CONFIG } from "@/config/aiTools";

const execFileAsync = promisify(execFile);

/**
 * Thrown when an uploaded file fails a business-rule validation (e.g. a video
 * clip exceeds the maximum duration) as opposed to an infrastructure error.
 * API routes map this to HTTP 422 rather than 500.
 */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

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
    currentCount: number,
    existingBytes = 0
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

    // Per-request total upload size cap (sum of already-stored bytes + this file).
    const totalError = validateTotalUploadSize(existingBytes, file.size);
    if (totalError) {
      return { valid: false, error: totalError };
    }

    return { valid: true };
  }

  /**
   * Sum the byte size of all non-deleted assets on a request. Used to enforce
   * the per-request total upload size cap before issuing a new presigned URL.
   */
  async sumUploadedBytes(requestId: string): Promise<number> {
    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    return assets
      .filter((a) => a.uploadStatus !== AssetUploadStatus.Deleted)
      // Number() guard: some repos surface fileSizeBytes as a string (Postgres
      // BIGINT), and `+` would concatenate rather than add.
      .reduce((sum, a) => sum + (Number(a.fileSizeBytes) || 0), 0);
  }

  /**
   * Probe a stored video's duration (seconds) with ffprobe. Downloads the
   * object from DO Spaces to a temp file, runs ffprobe, then cleans up.
   * Throws on any infrastructure/probe failure (caller decides fail-open vs
   * fail-closed).
   */
  private async probeVideoDurationSeconds(storageKey: string): Promise<number> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-clip-"));
    const tmpFile = path.join(tmpDir, "clip");
    try {
      const res = await spacesClient.send(
        new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: storageKey })
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      await fs.writeFile(tmpFile, Buffer.concat(chunks));

      const ffprobePath = (AI_CONFIG.ffmpeg.path ?? "ffmpeg").replace(
        /ffmpeg(\.exe)?$/i,
        (m) => (m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe")
      );

      const { stdout } = await execFileAsync(ffprobePath, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        tmpFile,
      ]);

      const duration = parseFloat(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`ffprobe returned invalid duration: "${stdout.trim()}"`);
      }
      return duration;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
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
  async confirmUpload(
    assetId: string,
    userId: string,
    /**
     * Optional poster frame captured in the browser (a `data:image/*;base64,…`
     * URL) for video clips. When present it's stored as the clip's thumbnail —
     * no server ffmpeg needed. Falls back to server-side frame extraction when
     * absent.
     */
    posterDataUrl?: string
  ): Promise<UploadedAsset> {
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Asset not found.");
    if (asset.userId !== userId) throw new Error("Access denied.");
    if (!asset.storageKey.startsWith("tmp/")) {
      throw new Error("Asset is not in pending (tmp) state.");
    }

    // Authoritative server-side clip-duration guard. Probe the just-uploaded
    // video (still in tmp/) and reject clips longer than the cap BEFORE moving
    // them into request_mat/. Probe infrastructure failures (ffprobe missing,
    // download error) fail OPEN — we log and allow the upload rather than block
    // legitimate uploads on an infra hiccup; the client-side check is the
    // first line of defence and over-long clips remain rare.
    if (asset.assetType === AssetType.Video) {
      let durationSeconds: number | null = null;
      try {
        durationSeconds = await this.probeVideoDurationSeconds(asset.storageKey);
      } catch (err) {
        console.error("[UploadService] clip duration probe failed (allowing upload):", err);
      }

      if (durationSeconds !== null) {
        const durationError = validateClipDuration(durationSeconds);
        if (durationError) {
          // Drop the rejected tmp object and mark the record Failed so the
          // request isn't left with a dangling pending asset.
          await spacesClient
            .send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: asset.storageKey }))
            .catch(() => {});
          await uploadedAssetRepository.update(assetId, {
            uploadStatus: AssetUploadStatus.Failed,
          });
          throw new UploadValidationError(durationError);
        }
      }
    }

    // Destination key in request_mat/
    const destKey = buildRequestMatKey(asset.userId, asset.requestId, asset.fileName);

    // Copy from tmp/ to request_mat/ — ACL must be public-read so external
    // services (e.g. the Veo video generator) can fetch the file without credentials.
    await spacesClient.send(
      new CopyObjectCommand({
        Bucket: SPACES_BUCKET,
        CopySource: `${SPACES_BUCKET}/${asset.storageKey}`,
        Key: destKey,
        ContentType: asset.mimeType,
        ACL: "public-read",
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
      // Generate immediately using sharp (resize + iterative quality reduction).
      // Non-fatal: if sharp can't decode the format (e.g. HEIC) or thumbnailing
      // otherwise fails, keep the asset — it must still become Uploaded with a
      // valid storageUrl so it appears in the storyboard/montage. The full image
      // is used as its own thumbnail fallback (thumbnailUrl || storageUrl).
      try {
        await generateImageThumbnail(destKey, thumbKey);
        thumbnailGenerated = true;
      } catch (err) {
        console.error(
          `[UploadService] thumbnail generation failed for "${asset.fileName}" (keeping image without thumbnail):`,
          err
        );
      }
    } else if (asset.assetType === AssetType.Video) {
      // Store the clip's poster thumbnail. Prefer the browser-captured poster
      // (no server ffmpeg dependency — this is why clips previously showed no
      // thumbnail while images did); fall back to server-side frame extraction
      // when the client didn't supply one. Non-fatal either way: keep the clip
      // Uploaded even if the poster can't be produced.
      try {
        if (posterDataUrl) {
          await storePosterThumbnail(posterDataUrl, thumbKey);
        } else {
          await generateVideoThumbnail(destKey, thumbKey);
        }
        thumbnailGenerated = true;
      } catch (err) {
        console.error(
          `[UploadService] video thumbnail generation failed for "${asset.fileName}" (keeping clip without thumbnail):`,
          err
        );
        // If the client poster failed, still try server-side extraction as a
        // last resort before giving up.
        if (posterDataUrl) {
          try {
            await generateVideoThumbnail(destKey, thumbKey);
            thumbnailGenerated = true;
          } catch (err2) {
            console.error(`[UploadService] fallback ffmpeg poster also failed for "${asset.fileName}":`, err2);
          }
        }
      }
    }

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
