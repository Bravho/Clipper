/**
 * Storage helpers for LINE-intake jobs.
 *
 * LINE uploads are always private (ACL: "private") and accessed only via
 * expiring signed URLs. Public URLs are never generated for LINE assets.
 */

import {
  spacesUpload,
  spacesSignedUrl,
  SPACES_BUCKET,
  spacesClient,
} from '@/lib/spaces';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  LINE_UPLOAD_PRESIGN_TTL_SECONDS,
  LINE_ASSET_SIGNED_URL_TTL_SECONDS,
} from '@/config/lineIntake';

/**
 * Upload a LINE-intake file to Spaces with private ACL.
 * Never use public-read for LINE assets.
 */
export async function uploadLineAsset(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  await spacesUpload({
    key: params.key,
    body: params.body,
    contentType: params.contentType,
    acl: 'private',
  });
}

/**
 * Generate an expiring presigned GET URL for a private LINE asset.
 */
export async function getLineAssetSignedUrl(key: string): Promise<string> {
  return spacesSignedUrl(key, LINE_ASSET_SIGNED_URL_TTL_SECONDS);
}

/**
 * Generate an expiring presigned PUT URL for a LINE-intake upload.
 * The shop (via grokbot) uploads directly to Spaces without holding our credentials.
 */
export async function generateLineUploadPutUrl(params: {
  key: string;
  contentType: string;
  maxBytes?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: params.key,
    ContentType: params.contentType,
    ACL: 'private',
    ...(params.maxBytes ? { ContentLength: params.maxBytes } : {}),
  });
  return getSignedUrl(spacesClient, cmd, { expiresIn: LINE_UPLOAD_PRESIGN_TTL_SECONDS });
}
