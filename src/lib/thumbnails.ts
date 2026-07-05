import sharp from "sharp";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spacesClient, SPACES_BUCKET } from "@/lib/spaces";
import { AI_CONFIG } from "@/config/aiTools";

const execFileAsync = promisify(execFile);

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
  return compressAndUpload(sourceBuffer, destKey);
}

/**
 * Resize + JPEG-compress an already-decoded image buffer to under 20 KB and
 * upload it to `destKey`. Shared by the image and video thumbnail paths.
 */
async function compressAndUpload(sourceBuffer: Buffer, destKey: string): Promise<number> {
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
      ACL: "public-read",
    })
  );

  return thumbBuffer.byteLength;
}

/**
 * Store a client-captured poster (a `data:image/...;base64,...` URL produced in
 * the browser from a `<video>` frame) as an asset thumbnail.
 *
 * This is the PRIMARY path for video posters: the browser already decoded a
 * frame at upload time, so we don't depend on server-side ffmpeg being installed
 * (which is why video clips previously showed no thumbnail while images did). The
 * decoded JPEG is resized + compressed under 20 KB and uploaded to `destKey`.
 *
 * @returns The byte size of the uploaded thumbnail.
 * @throws  If the data URL is malformed / not a base64 image.
 */
export async function storePosterThumbnail(
  dataUrl: string,
  destKey: string
): Promise<number> {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw new Error("Invalid poster data URL (expected base64 image)");
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.byteLength === 0) throw new Error("Poster data URL decoded to empty buffer");
  return compressAndUpload(buffer, destKey);
}

/** Derive the ffprobe path from the configured ffmpeg path. */
function ffprobePathFrom(ffmpegPath: string): string {
  return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) =>
    m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"
  );
}

/**
 * Generate a JPEG poster thumbnail for a video already stored in DO Spaces.
 *
 * Downloads the clip, probes its duration, extracts a representative frame near
 * the midpoint with ffmpeg (avoids a black first frame), then resizes/compresses
 * it under 20 KB and uploads to `destKey` — so downstream steps can render the
 * clip's `thumbnailUrl` with a plain <img> exactly like image assets.
 *
 * @returns The byte size of the uploaded thumbnail.
 */
export async function generateVideoThumbnail(
  sourceKey: string,
  destKey: string
): Promise<number> {
  const ffmpegPath = AI_CONFIG.ffmpeg.path ?? "ffmpeg";
  const videoBuffer = await downloadToBuffer(sourceKey);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-poster-"));
  const input = path.join(tmpDir, "clip");
  const output = path.join(tmpDir, "poster.jpg");
  try {
    await fs.writeFile(input, videoBuffer);

    // Seek to the midpoint (fallback to 0s if the duration can't be probed).
    let seekSeconds = 0;
    try {
      const { stdout } = await execFileAsync(ffprobePathFrom(ffmpegPath), [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input,
      ]);
      const duration = parseFloat(stdout.trim());
      if (Number.isFinite(duration) && duration > 0) seekSeconds = duration / 2;
    } catch {
      /* unknown duration → grab the first frame */
    }

    await execFileAsync(ffmpegPath, [
      "-ss", String(seekSeconds),
      "-i", input,
      "-frames:v", "1",
      "-q:v", "2",
      "-y", output,
    ]);

    const frameBuffer = await fs.readFile(output);
    // Reuse the image path's resize + <20 KB compression + upload.
    return await compressAndUpload(frameBuffer, destKey);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
