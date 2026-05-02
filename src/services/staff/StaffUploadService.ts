import { PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import { UploadedAsset } from "@/domain/models/UploadedAsset";
import { uploadedAssetRepository } from "@/repositories";
import { spacesClient, SPACES_BUCKET, spacesPublicUrl } from "@/lib/spaces";
import { buildTmpKey, buildClipKey } from "@/lib/spacesKeys";

/**
 * StaffUploadService — manages upload of the final edited clip by staff.
 *
 * Uses the same two-step presigned flow as UploadService (requester uploads):
 *   1. createPresignedClipUpload() — presigned PUT to tmp/, creates Pending asset record
 *   2. confirmClipUpload()         — copies tmp/ → clips/, marks as Uploaded
 *
 * Edited clips are stored under clips/{userId}/{date}/{requestId}/ and
 * retained for 8 years per the DO Spaces lifecycle policy.
 *
 * The file bytes never pass through the Next.js server.
 */

/** Presigned PUT URL valid for 15 minutes. */
const PRESIGNED_TTL = 15 * 60;

/** Max edited clip size: 150 MB */
export const MAX_CLIP_SIZE_BYTES = 150 * 1024 * 1024;

/** Only MP4 is accepted for edited clips. */
const ACCEPTED_CLIP_MIME_TYPE = "video/mp4";

export interface PresignedClipUploadResult {
  assetId: string;
  presignedUrl: string;
}

export class StaffUploadService {
  /**
   * Step 1 — Generate a presigned PUT URL and create a Pending asset record.
   * The client uploads the file directly to DO Spaces using the returned URL.
   */
  async createPresignedClipUpload(input: {
    requestId: string;
    staffId: string;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  }): Promise<PresignedClipUploadResult> {
    if (input.mimeType !== ACCEPTED_CLIP_MIME_TYPE) {
      throw new Error("Edited clip must be an MP4 file.");
    }
    if (input.fileSizeBytes > MAX_CLIP_SIZE_BYTES) {
      throw new Error("File exceeds the 150 MB size limit.");
    }

    const tmpKey = buildTmpKey(input.staffId, input.requestId, input.fileName);

    const command = new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: tmpKey,
      ContentType: input.mimeType,
    });

    const presignedUrl = await getSignedUrl(spacesClient, command, {
      expiresIn: PRESIGNED_TTL,
    });

    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setFullYear(scheduledDeletionAt.getFullYear() + 8);

    const asset = await uploadedAssetRepository.create({
      requestId: input.requestId,
      userId: input.staffId,
      fileName: input.fileName,
      assetType: AssetType.EditedClip,
      fileSizeBytes: input.fileSizeBytes,
      mimeType: input.mimeType,
      storageKey: tmpKey,
      storageUrl: "",
      thumbnailKey: "",
      thumbnailUrl: "",
      uploadStatus: AssetUploadStatus.Pending,
      scheduledDeletionAt,
    });

    return { assetId: asset.id, presignedUrl };
  }

  /**
   * Step 2 — Confirm the upload.
   * Copies the object from tmp/ to clips/, deletes the tmp/ object,
   * and marks the asset record as Uploaded.
   */
  async confirmClipUpload(assetId: string, staffId: string): Promise<UploadedAsset> {
    const asset = await uploadedAssetRepository.findById(assetId);
    if (!asset) throw new Error("Asset not found.");
    if (asset.userId !== staffId) throw new Error("Access denied.");
    if (asset.assetType !== AssetType.EditedClip) {
      throw new Error("Asset is not an edited clip.");
    }
    if (!asset.storageKey.startsWith("tmp/")) {
      throw new Error("Asset is not in pending state.");
    }

    const destKey = buildClipKey(asset.userId, asset.requestId, asset.fileName);

    await spacesClient.send(
      new CopyObjectCommand({
        Bucket: SPACES_BUCKET,
        CopySource: `${SPACES_BUCKET}/${asset.storageKey}`,
        Key: destKey,
        ContentType: asset.mimeType,
      })
    );

    await spacesClient.send(
      new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: asset.storageKey })
    );

    return uploadedAssetRepository.update(assetId, {
      storageKey: destKey,
      storageUrl: spacesPublicUrl(destKey),
      uploadStatus: AssetUploadStatus.Uploaded,
    });
  }

  /** Return the latest uploaded edited clip for a request, or null. */
  async getEditedClip(requestId: string): Promise<UploadedAsset | null> {
    const assets = await uploadedAssetRepository.findByRequestId(requestId);
    const clips = assets
      .filter(
        (a) =>
          a.assetType === AssetType.EditedClip &&
          a.uploadStatus === AssetUploadStatus.Uploaded
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return clips[0] ?? null;
  }
}

export const staffUploadService = new StaffUploadService();
