import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { spacesClient, SPACES_BUCKET } from "@/lib/spaces";

/**
 * Thumbnail generation utilities for DigitalOcean Spaces assets.
 *
 * Size constraint: all generated thumbnails must be < 20 KB.
 *
 * Strategy:
 *   - Resize to fit within THUMBNAIL_MAX_DIMENSION × THUMBNAIL_MAX_DIMENSION
 *     (preserving aspect ratio, never enlarging)
 *   - Encode as JPEG starting at INITIAL_QUALITY
 *   - Reduce quality by QUALITY_STEP each pass until the output is < 20 KB
 *     or the minimum quality floor is reached
 *
 * Image files (JPEG, PNG, WebP, GIF):  handled here using sharp.
 * Video files:  require a first-frame extraction step before calling this
 *               function. See the TODO below.
 */

const MAX_THUMBNAIL_BYTES = 20 * 1024; // 20 KB
const THUMBNAIL_MAX_DIMENSION = 320;   // max width OR height
const INITIAL_QUALITY = 75;
const QUALITY_STEP = 10;
const MIN_QUALITY = 10;

/**
 * Download an object from DO Spaces and return it as a Buffer.
 */
async function downloadToBuffer(key: string): Promise<Buffer> {
  const res = await spacesClient.send(
    new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key })
  );

  if (!res.Body) throw new Error(`Empty body for key: ${key}`);

  // Body can be a Web ReadableStream or a Node Readable depending on runtime
  if (res.Body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Web ReadableStream (Edge runtime / newer Node versions)
  const reader = (res.Body as ReadableStream<Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * Generate a JPEG thumbnail for an image already stored in DO Spaces.
 *
 * Downloads the source object at `sourceKey`, resizes and compresses it
 * to under 20 KB, then uploads the result to `destKey`.
 *
 * Supported source formats: JPEG, PNG, WebP, GIF (anything sharp can decode).
 *
 * @returns The byte size of the uploaded thumbnail.
 */
export async function generateImageThumbnail(
  sourceKey: string,
  destKey: string
): Promise<number> {
  const sourceBuffer = await downloadToBuffer(sourceKey);

  let quality = INITIAL_QUALITY;
  let thumbBuffer: Buffer = Buffer.alloc(0);

  do {
    thumbBuffer = await sharp(sourceBuffer)
      .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, progressive: false })
      .toBuffer();

    if (thumbBuffer.byteLength < MAX_THUMBNAIL_BYTES) break;
    quality -= QUALITY_STEP;
  } while (quality >= MIN_QUALITY);

  await spacesClient.send(
    new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: destKey,
      Body: thumbBuffer,
      ContentType: "image/jpeg",
    })
  );

  return thumbBuffer.byteLength;
}

/**
 * TODO: Video thumbnail generation.
 *
 * Requires ffmpeg (e.g. via the `fluent-ffmpeg` package + ffmpeg binary).
 * Steps:
 *   1. Download the video from `sourceKey` to a temp file (or stream).
 *   2. Use ffmpeg to extract the frame at 00:00:01 (or mid-point) as a JPEG.
 *   3. Pass the extracted frame buffer to generateImageThumbnail() logic
 *      (resize + quality reduction to stay under 20 KB).
 *   4. Upload the result to `destKey` in DO Spaces.
 *
 * Recommended approach:
 *   - Use a Next.js background job or a separate worker process for this,
 *     since ffmpeg processing can be slow and should not block the API response.
 *   - Store the thumbnail key in the asset record immediately (as a pending path),
 *     then update thumbnailUrl once the worker completes (via updateThumbnail()).
 */
export async function generateVideoThumbnail(
  _sourceKey: string,
  _destKey: string
): Promise<number> {
  throw new Error(
    "Video thumbnail generation is not yet implemented. " +
    "Requires ffmpeg. See the TODO in src/lib/thumbnails.ts."
  );
}
