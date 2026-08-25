import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type { ListPartsCommandOutput } from "@aws-sdk/client-s3";
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

/**
 * Multipart part size for browser uploads: 5 MB — the S3 minimum part size and,
 * critically, safely under the ~8–15 MB single-request-body cap imposed by the
 * HTTPS-inspecting network intermediary documented in lib/spaces.ts. Each part
 * is its own ≤5 MB PUT that clears the cap, which is why a large video that
 * fails as one big PUT succeeds when chunked. The browser slices the file into
 * ceil(size / PART) parts; the server signs part numbers 1..N.
 */
export const MULTIPART_PART_SIZE = 5 * 1024 * 1024;

/** Files larger than this use multipart; smaller ones use a single presigned PUT. */
export const MULTIPART_THRESHOLD = MULTIPART_PART_SIZE;

export interface MultipartInitResult {
  assetId: string;
  key: string;
  uploadId: string;
  partSize: number;
}

/**
 * A requester-uploaded SOURCE file that is actually stored.
 *
 * Both per-request caps — MAX_UPLOAD_COUNT and MAX_UPLOAD_SIZE_BYTES — are about
 * the material the requester supplies. Two filters, both load-bearing:
 *
 *  • uploadStatus === Uploaded. A Pending row is an upload *attempt*, created up
 *    front by every presign/initiate; counting those made each failed retry leave
 *    a phantom that still consumed a slot and its full byte size, so a few
 *    retries on one draft tripped "Maximum N files per request." before the
 *    upload even started.
 *
 *  • assetType is Image or Video. Everything else on a request is machine
 *    output — AI base videos, per-scene renders, final exports, watermarked
 *    previews, voice tracks. Counting those against a *requester upload* cap
 *    means a request that has been through the pipeline can never accept another
 *    source file, and its exports (hundreds of MB) blow the 500 MB budget on
 *    their own. Harmless while a request is still a Draft, which is why it has
 *    not bitten yet — and guaranteed to bite the moment either cap is checked
 *    after generation has run.
 */
function isStoredSourceAsset(asset: {
  uploadStatus: AssetUploadStatus;
  assetType: AssetType;
}): boolean {
  return (
    asset.uploadStatus === AssetUploadStatus.Uploaded &&
    (asset.assetType === AssetType.Image || asset.assetType === AssetType.Video)
  );
}

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
    return (
      assets
        .filter(isStoredSourceAsset)
        // Number() guard: some repos surface fileSizeBytes as a string (Postgres
        // BIGINT), and `+` would concatenate rather than add.
        .reduce((sum, a) => sum + (Number(a.fileSizeBytes) || 0), 0)
    );
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
   * Drop any *Pending* asset rows for the same file on the same request before
   * minting a new one.
   *
   * WHY: both upload entry points (`createPresignedUpload` and
   * `createMultipartUpload`) create a Pending `uploaded_assets` row up front, and
   * nothing ever removed it if that attempt then failed — a dropped connection,
   * an expired multipart session, the app being killed mid-upload. Every retry
   * of the same file therefore left another phantom row behind, and the request
   * detail page renders every non-Deleted asset, so the user saw a growing list
   * of files that look half-uploaded but can never complete.
   *
   * `countAssets()` already had to filter these out to stop them tripping the
   * MAX_UPLOAD_COUNT cap — that was treating the symptom. This removes them at
   * the source, so a retry supersedes the previous attempt instead of stacking
   * on top of it.
   *
   * Only Pending rows are touched: an Uploaded row is a real stored file, and a
   * Deleted row is already accounted for. The orphaned tmp/ object is removed
   * too (best-effort — it may never have been written, and the bucket's 1-day
   * tmp/ lifecycle rule is the backstop). An abandoned multipart upload's parts
   * are swept by the bucket's AbortIncompleteMultipartUpload rule.
   */
  private async discardSupersededPending(input: {
    requestId: string;
    fileName: string;
    fileSizeBytes: number;
  }): Promise<void> {
    let superseded;
    try {
      const assets = await uploadedAssetRepository.findByRequestId(input.requestId);
      superseded = assets.filter(
        (a) =>
          a.uploadStatus === AssetUploadStatus.Pending &&
          a.fileName === input.fileName &&
          Number(a.fileSizeBytes) === input.fileSizeBytes
      );
    } catch (err) {
      // Never block a fresh upload because cleanup could not run.
      console.error("[upload] could not scan for superseded pending assets:", err);
      return;
    }

    for (const asset of superseded) {
      if (asset.storageKey) {
        try {
          await spacesClient.send(
            new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: asset.storageKey })
          );
        } catch {
          /* object may never have been written — the tmp/ lifecycle rule sweeps it */
        }
      }
      try {
        await uploadedAssetRepository.deleteById(asset.id);
      } catch (err) {
        console.error(`[upload] could not delete superseded pending asset ${asset.id}:`, err);
      }
    }

    if (superseded.length > 0) {
      console.info(
        `[upload] discarded ${superseded.length} superseded Pending record(s) for "${input.fileName}" on request ${input.requestId}`
      );
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
    await this.discardSupersededPending(input);

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
   * Multipart step 1 — initiate.
   *
   * Creates the tmp/ multipart upload on Spaces and the Pending asset record
   * (same shape as createPresignedUpload). The browser then PUTs each ≤5 MB part
   * to a presigned part URL, calls `signUploadParts` for those URLs, and finally
   * `completeMultipartUpload`. After completion the object sits at the tmp/ key
   * exactly as a single PUT would leave it, so the existing confirm flow
   * (`confirmUpload`) applies unchanged.
   */
  async createMultipartUpload(input: {
    requestId: string;
    userId: string;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  }): Promise<MultipartInitResult> {
    // A fresh initiate means the previous attempt at this file is dead (its
    // session expired, or the client lost it). Retire its Pending record so
    // retries supersede rather than accumulate.
    await this.discardSupersededPending(input);

    const key = buildTmpKey(input.userId, input.requestId, input.fileName);

    const created = await spacesClient.send(
      new CreateMultipartUploadCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        ContentType: input.mimeType,
      })
    );
    if (!created.UploadId) {
      throw new Error("Spaces did not return an UploadId for the multipart upload.");
    }

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

    return { assetId: asset.id, key, uploadId: created.UploadId, partSize: MULTIPART_PART_SIZE };
  }

  /**
   * Multipart step 2 — sign N part-upload URLs. Each is a presigned PUT for one
   * UploadPart. The browser PUTs a ≤5 MB slice to each and reads the returned
   * ETag (exposed via the bucket CORS ExposeHeaders rule) to pass to complete.
   */
  async signUploadParts(input: {
    key: string;
    uploadId: string;
    partCount?: number;
    /**
     * Explicit part numbers to sign. Used by the RESUME path to re-sign only the
     * parts that never landed. When omitted, signs a contiguous 1..partCount range
     * (the fresh-upload path).
     */
    partNumbers?: number[];
  }): Promise<{ partNumber: number; url: string }[]> {
    const numbers =
      input.partNumbers && input.partNumbers.length > 0
        ? input.partNumbers
        : Array.from({ length: input.partCount ?? 0 }, (_, i) => i + 1);

    const urls: { partNumber: number; url: string }[] = [];
    for (const partNumber of numbers) {
      const url = await getSignedUrl(
        spacesClient,
        new UploadPartCommand({
          Bucket: SPACES_BUCKET,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: PRESIGNED_URL_TTL }
      );
      urls.push({ partNumber, url });
    }
    return urls;
  }

  /**
   * Multipart RESUME — list the parts already stored for an in-progress upload so
   * the browser can re-sign and PUT only the MISSING parts instead of restarting
   * a large video from zero. This is what makes resume cheap on flaky mobile
   * (iOS/Android) connections. Paginated: Spaces returns ≤1000 parts per page.
   * Returns parts sorted by number with the ETag Spaces recorded (quoted — the
   * same form CompleteMultipartUpload expects). Propagates NoSuchUpload so the
   * caller can fall back to a fresh initiate.
   */
  async listUploadedParts(input: {
    key: string;
    uploadId: string;
  }): Promise<{ PartNumber: number; ETag: string }[]> {
    const parts: { PartNumber: number; ETag: string }[] = [];
    let marker: string | undefined = undefined;
    do {
      const res: ListPartsCommandOutput = await spacesClient.send(
        new ListPartsCommand({
          Bucket: SPACES_BUCKET,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumberMarker: marker,
        })
      );
      for (const p of res.Parts ?? []) {
        if (typeof p.PartNumber === "number" && typeof p.ETag === "string") {
          parts.push({ PartNumber: p.PartNumber, ETag: p.ETag });
        }
      }
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    return parts;
  }

  /**
   * Multipart step 3 — complete. Assembles the uploaded parts into the final
   * tmp/ object. Parts are sorted by number as S3/Spaces requires.
   */
  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: { PartNumber: number; ETag: string }[];
  }): Promise<void> {
    const parts = [...input.parts].sort((a, b) => a.PartNumber - b.PartNumber);
    await spacesClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: SPACES_BUCKET,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: { Parts: parts },
      })
    );
  }

  /**
   * Multipart cleanup — abort a dangling upload (best-effort) so a failed or
   * cancelled upload leaves no half-assembled object accruing storage.
   */
  async abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void> {
    await spacesClient
      .send(
        new AbortMultipartUploadCommand({
          Bucket: SPACES_BUCKET,
          Key: input.key,
          UploadId: input.uploadId,
        })
      )
      .catch(() => {});
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
    //
    // The probed length is also PERSISTED on the asset below (durationSeconds),
    // so downstream steps use a clip's true length in the storyboard/voice
    // estimate rather than a flat per-asset guess.
    let clipDurationSeconds: number | null = null;
    if (asset.assetType === AssetType.Video) {
      try {
        clipDurationSeconds = await this.probeVideoDurationSeconds(asset.storageKey);
      } catch (err) {
        console.error("[UploadService] clip duration probe failed (allowing upload):", err);
      }

      if (clipDurationSeconds !== null) {
        const durationError = validateClipDuration(clipDurationSeconds);
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
      // Persist the probed clip length (null for images / failed probe).
      durationSeconds: clipDurationSeconds,
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

    // Every object the request owns: the file itself AND its generated poster.
    // thumbnailKey used to be skipped, so cancelling a request left its posters
    // in the bucket with no row pointing at them — unreachable, unbilled to any
    // request, and invisible to the retention sweep.
    const keys = assets.flatMap((a) =>
      [a.storageKey, a.thumbnailKey].filter((k): k is string => Boolean(k))
    );

    // One failed delete must not abort the rest, or a single missing object
    // would leave the remaining files orphaned in the bucket. allSettled +
    // per-key logging; the DB rows go regardless, and the bucket lifecycle
    // rules are the backstop for anything that genuinely failed to delete.
    const results = await Promise.allSettled(
      keys.map((Key) =>
        spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key }))
      )
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(`[upload] failed to delete ${keys[i]}:`, result.reason);
      }
    });

    await uploadedAssetRepository.deleteByRequestId(requestId);
  }

  /**
   * Count CONFIRMED uploads for a request (for the MAX_UPLOAD_COUNT limit check).
   *
   * Only Uploaded assets count. Counting every record made each failed multipart
   * `initiate` (which creates a Pending asset up front) leave a phantom record
   * that still counted toward the cap, so a handful of retries on the same draft
   * eventually tripped "Maximum N files per request." at initiate — blocking the
   * upload before it even started. Pending/Failed records are never confirmed
   * stored files, so they must not count. Mirrors sumUploadedBytes().
   */
  async countAssets(requestId: string): Promise<number> {
    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    return assets.filter(isStoredSourceAsset).length;
  }
}

// Singleton instance
export const uploadService = new UploadService();
