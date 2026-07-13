import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * DigitalOcean Spaces S3-compatible client.
 *
 * DO Spaces is fully compatible with the AWS S3 API.
 * The endpoint must point to the region base (e.g. https://sgp1.digitaloceanspaces.com).
 *
 * Required env vars:
 *   DO_SPACES_ENDPOINT  — e.g. https://sgp1.digitaloceanspaces.com
 *   DO_SPACES_REGION    — e.g. sgp1
 *   DO_SPACES_KEY       — Spaces access key ID
 *   DO_SPACES_SECRET    — Spaces secret access key
 *   DO_SPACES_BUCKET    — bucket (Space) name
 */
export const spacesClient = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT,
  region: process.env.DO_SPACES_REGION ?? "sgp1",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
  },
  // forcePathStyle generates https://{endpoint}/{bucket}/{key} instead of
  // https://{bucket}.{endpoint}/{key}. Required for DO Spaces — the virtual-hosted
  // subdomain format causes ERR_CERT_COMMON_NAME_INVALID in browsers because
  // the bucket subdomain is not covered by the DO Spaces SSL certificate.
  forcePathStyle: true,
  // @aws-sdk/client-s3 >= 3.729 adds CRC32 integrity checksums by default
  // (x-amz-checksum-* headers + aws-chunked trailing checksums on streaming
  // PUTs). DigitalOcean Spaces rejects these with an opaque 400 "UnknownError",
  // which surfaces on large streaming uploads (e.g. the montage merge step).
  // Only send/validate checksums when the API actually requires them.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const SPACES_BUCKET = process.env.DO_SPACES_BUCKET!;

/**
 * Run a single DO Spaces operation with bounded exponential-backoff retries.
 *
 * DO Spaces intermittently throttles or resets a request (especially under the
 * concurrent up/downloads the render pipeline generates) and the AWS SDK
 * surfaces these transient failures as an anonymous 400 "UnknownError" whose
 * `String(err)` hides the HTTP status and cause. Retrying absorbs the transient
 * case; on genuine failure we throw an error naming the operation and the SDK
 * metadata so the worker log actually identifies what went wrong.
 *
 * Every heavy-step Spaces send (upload/download in remotionService,
 * animationService, ffmpegService, …) should go through this so a single
 * transient 400 never fails a whole pipeline step. The compose step already had
 * this resilience via a private copy in `ffmpegService`; this is the shared,
 * reusable version.
 */
export async function spacesSendWithRetry<T>(
  label: string,
  send: () => Promise<T>,
  attempts = 4
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await send();
    } catch (err) {
      lastErr = err;
      // DO Spaces sometimes returns a 400 whose XML body the SDK can't map to a
      // known error, surfacing it as name/message "UnknownError" and hiding the
      // real `<Code>`. Dump every field the SDK DID attach (Code, message, the
      // raw response body if present, $metadata) so the log actually names the
      // cause instead of "UnknownError".
      console.error(
        `[spaces] ${label} attempt ${i + 1}/${attempts} failed: ${describeSpacesError(err)}`
      );
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw new Error(`Spaces ${label} failed after ${attempts} attempts: ${describeSpacesError(lastErr)}`);
}

/**
 * Upload an object to DO Spaces using a MULTIPART upload.
 *
 * Why not a plain PutObject: a single PutObject of a large video (≈150 MB+)
 * over the render worker's uplink cannot finish inside DO Spaces' ~50-second
 * request window, so Spaces cuts the connection and returns an opaque
 * 400 "UnknownError" (observed: 200 MB and 1 GB single PUTs both failed at
 * ~51 s, while small objects succeed instantly). This is what stalled the
 * `overlay_composition` step — and it affects every large export (compose
 * masters, montage base, styled/overlay clips, watermarked previews).
 *
 * `Upload` splits the body into small parts (8 MB), each its own short request
 * that completes well under the window, and uploads several in parallel. Bodies
 * smaller than one part are sent as a single request automatically, so this is
 * safe for every size. The whole upload is retried on failure (a failed
 * multipart leaves no committed object — `leavePartsOnError` stays false).
 */
export async function spacesUpload(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  acl?: "public-read" | "private";
}): Promise<void> {
  await spacesSendWithRetry(`upload ${params.key}`, async () => {
    const upload = new Upload({
      client: spacesClient,
      params: {
        Bucket: SPACES_BUCKET,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ACL: params.acl ?? "public-read",
      },
      partSize: 8 * 1024 * 1024, // 8 MB parts — each a short, sub-window request
      queueSize: 4, // upload 4 parts in parallel to use available bandwidth
      leavePartsOnError: false, // abort (clean up) a failed multipart so retry is clean
    });
    await upload.done();
  });
}

/** Extract every diagnostic field an AWS SDK S3 error carries into one string. */
function describeSpacesError(err: unknown): string {
  const e = err as Record<string, unknown> & {
    name?: string;
    message?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
    $response?: { statusCode?: number; body?: unknown };
  };
  const rawBody =
    typeof e?.$response?.body === "string" ? e.$response.body.slice(0, 400) : undefined;
  return JSON.stringify({
    name: e?.name,
    code: e?.Code,
    message: e?.message,
    http: e?.$metadata?.httpStatusCode ?? e?.$response?.statusCode,
    rawBody,
  });
}

/**
 * Build a public URL for a stored object.
 *
 * Uses DO_SPACES_CDN_ENDPOINT if set (recommended for delivery performance).
 * Falls back to the standard Spaces URL format:
 *   https://{bucket}.{region}.digitaloceanspaces.com/{key}
 */
export function spacesPublicUrl(key: string): string {
  if (process.env.DO_SPACES_CDN_ENDPOINT) {
    return `${process.env.DO_SPACES_CDN_ENDPOINT}/${key}`;
  }
  // Path-style URL to match forcePathStyle: true on the S3 client
  const endpoint = process.env.DO_SPACES_ENDPOINT!;
  const bucket = process.env.DO_SPACES_BUCKET!;
  return `${endpoint}/${bucket}/${key}`;
}

/** Default lifetime for a presigned GET URL (1 hour). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Build a short-lived presigned GET URL for a private object.
 *
 * Use this for anything that should NOT be world-readable via a public URL —
 * raw uploads (`request_mat/`), base renders (`ai_videos/`), and final
 * deliverables served for the 7-day download window. Thumbnails remain public
 * and should keep using `spacesPublicUrl`.
 *
 * NOTE: privatising these prefixes also requires uploading their objects with
 * `ACL: "private"` (they are currently written with `ACL: "public-read"`, which
 * keeps them publicly reachable regardless of the bucket policy).
 */
export async function spacesSignedUrl(
  key: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS
): Promise<string> {
  return getSignedUrl(
    spacesClient,
    new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
    { expiresIn: ttlSeconds }
  );
}
