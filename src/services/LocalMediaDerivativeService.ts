import sharp from "sharp";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import type { LocalMediaSubmission } from "@/lib/mobile/localMediaContract";
import { uploadedAssetRepository } from "@/repositories/index";
import { spacesClient, SPACES_BUCKET, spacesPublicUrl } from "@/lib/spaces";
import { buildRequestMatKey } from "@/lib/spacesKeys";

/**
 * Persist compact photo derivatives for the existing image analysis/render
 * path. A video frame must never stand in for its moving source in a montage.
 */
export async function storeLocalMediaDerivatives(
  requestId: string,
  userId: string,
  submission: LocalMediaSubmission
): Promise<string[]> {
  const existing = await uploadedAssetRepository.findByRequestId(requestId);
  const urls: string[] = [];

  if (submission.materials.some((material) => material.mimeType.startsWith("video/"))) {
    throw new Error("Local video requires a verified device render; a still image cannot replace it");
  }

  for (const [index, material] of submission.materials.entries()) {
    const fileName = `local-preview-${index}-${material.localId}.jpg`;
    const alreadyStored = existing.find(
      (asset) =>
        asset.fileName === fileName &&
        asset.assetType === AssetType.Image &&
        asset.uploadStatus === AssetUploadStatus.Uploaded
    );
    if (alreadyStored?.storageUrl) {
      urls.push(alreadyStored.storageUrl);
      continue;
    }

    const frame = submission.analysisFrames.find(
      (candidate) => candidate.assetIndex === index && candidate.localId === material.localId
    );
    if (!frame) throw new Error(`Missing analysis frame for ${material.localId}`);

    // Decode and normalise again on the server. Never trust the client MIME or
    // dimensions, and cap pixels/quality before anything is written to Spaces.
    const jpeg = await sharp(Buffer.from(frame.dataBase64, "base64"), {
      limitInputPixels: 20_000_000,
    })
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const key = buildRequestMatKey(userId, requestId, fileName);
    await spacesClient.send(new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      Body: jpeg,
      ContentType: "image/jpeg",
      ACL: "public-read",
    }));
    try {
      const asset = await uploadedAssetRepository.create({
        requestId,
        userId,
        fileName,
        assetType: AssetType.Image,
        fileSizeBytes: jpeg.length,
        mimeType: "image/jpeg",
        storageKey: key,
        storageUrl: spacesPublicUrl(key),
        thumbnailKey: "",
        thumbnailUrl: "",
        uploadStatus: AssetUploadStatus.Uploaded,
        durationSeconds: null,
        videoRatio: null,
        scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      urls.push(asset.storageUrl);
    } catch (error) {
      await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }))
        .catch(() => undefined);
      throw error;
    }
  }

  return urls;
}
