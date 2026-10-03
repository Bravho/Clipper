import sharp from "sharp";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { AssetType, AssetUploadStatus } from "@/domain/enums/AssetType";
import type { LocalMediaSubmission } from "@/lib/mobile/localMediaContract";
import { uploadedAssetRepository } from "@/repositories/index";
import { spacesClient, SPACES_BUCKET, spacesPublicUrl } from "@/lib/spaces";
import { buildRequestMatKey } from "@/lib/spacesKeys";

/**
 * Persist the small derivatives the server needs for media that stays on the
 * requester's phone.
 *
 * WHAT GOES UP: one resized JPEG per material — a photo's own pixels, or a
 * poster frame grabbed from a clip. That is what Gemini analyses, what the
 * scene designer reasons about, and what every thumbnail in the product shows.
 * A few hundred kilobytes, not a few hundred megabytes.
 *
 * WHAT NEVER GOES UP: the originals. For a photo the derivative is a faithful
 * enough stand-in that the server can still render from it. For a CLIP it is
 * not — a poster frame is a still, and animating a still where moving footage
 * belongs produces a video that looks almost right, which is the worst kind of
 * wrong. So a clip's asset row carries `deviceLocalId`, which marks it as
 * renderable only on the device that holds it, and the render queue refuses to
 * offer that work to the Mac Mini worker.
 *
 * This function used to throw on any video material, because at the time there
 * was nothing that could render one. There is now.
 */
export async function storeLocalMediaDerivatives(
  requestId: string,
  userId: string,
  submission: LocalMediaSubmission
): Promise<string[]> {
  const existing = await uploadedAssetRepository.findByRequestId(requestId);
  const urls: string[] = [];

  for (const [index, material] of submission.materials.entries()) {
    const isClip = material.mimeType.startsWith("video/");
    // The file name encodes which kind this is so a resubmission finds the same
    // row: a clip's asset is a Video whose bytes are elsewhere, and a photo's
    // is an Image whose bytes are the derivative itself.
    const fileName = isClip
      ? `local-clip-${index}-${material.localId}.jpg`
      : `local-preview-${index}-${material.localId}.jpg`;
    const assetType = isClip ? AssetType.Video : AssetType.Image;
    const alreadyStored = existing.find(
      (asset) =>
        asset.fileName === fileName &&
        asset.assetType === assetType &&
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
        assetType,
        // The stored bytes are the derivative's. A clip's real size stays on
        // the phone and is deliberately NOT counted against the request's
        // upload budget — nothing was uploaded.
        fileSizeBytes: jpeg.length,
        mimeType: isClip ? material.mimeType : "image/jpeg",
        storageKey: key,
        storageUrl: spacesPublicUrl(key),
        // A clip's poster is also its thumbnail, so every list, picker and
        // review panel has something to show without a second derivative.
        thumbnailKey: isClip ? key : "",
        thumbnailUrl: isClip ? spacesPublicUrl(key) : "",
        uploadStatus: AssetUploadStatus.Uploaded,
        // Carried from the device's own probe: the scene planner sizes a shot's
        // slot against it, and the render contract refuses a trim beyond it.
        durationSeconds: isClip ? material.durationSeconds ?? null : null,
        videoRatio: null,
        // The handle that makes this renderable on the phone and nowhere else.
        deviceLocalId: isClip ? material.localId : null,
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
