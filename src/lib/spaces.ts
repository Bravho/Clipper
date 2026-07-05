import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
});

export const SPACES_BUCKET = process.env.DO_SPACES_BUCKET!;

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
