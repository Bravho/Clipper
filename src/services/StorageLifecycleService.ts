import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { spacesClient, SPACES_BUCKET } from "@/lib/spaces";
import mediaPrefixConfig from "@/config/mediaPrefixes.json";

/**
 * StorageLifecycleService — cascade deletion of a request's media in Spaces.
 *
 * Retention model (see docs/storage-lifecycle-design.md): a request's media is
 * fully purged (raw uploads + ALL processed intermediates + final clips) at the
 * earlier of "Delivered/Published + 7 days" or "auto-cancelled after 30 days of
 * inactivity". Thumbnails are retained (2-year Spaces lifecycle rule) so request
 * history still renders.
 *
 * The cascade requirement ("deleting the uploads deletes every processed
 * artefact too") is satisfied structurally: raw uploads are only ever removed
 * through `purgeRequestMedia`, which deletes across every media prefix in one
 * call. S3 bucket-lifecycle rules remain only as a coarse backstop.
 *
 * Key layout (src/lib/spacesKeys.ts):
 *   {prefix}/{userId}/{YYYY-MM-DD}/{requestId}/...
 * We cannot address by requestId alone (the date segment is unknown), so we
 * list each prefix under `{prefix}/{userId}/` and filter keys containing
 * `/{requestId}/`.
 */

/**
 * Every media prefix that can hold artefacts for a request.
 * Sourced from src/config/mediaPrefixes.json — shared with
 * scripts/retention-sweep.js so the two lists cannot drift.
 */
export const REQUEST_MEDIA_PREFIXES: readonly string[] =
  mediaPrefixConfig.mediaPrefixes;

/** Prefix that is intentionally preserved when `keepThumbnails` is set. */
export const THUMBNAIL_PREFIX = mediaPrefixConfig.thumbnailPrefix;

export interface PurgeResult {
  requestId: string;
  deletedKeys: string[];
  errors: { key: string; message: string }[];
}

export interface PurgeOptions {
  userId: string;
  requestId: string;
  /** Keep thumbnails/ objects (default true — needed for request-history UI). */
  keepThumbnails?: boolean;
}

export class StorageLifecycleService {
  constructor(
    private readonly client = spacesClient,
    private readonly bucket = SPACES_BUCKET
  ) {}

  /**
   * List every object key belonging to a request across all media prefixes.
   * When `includeThumbnails` is false, the thumbnails/ prefix is skipped.
   */
  async listRequestKeys(
    userId: string,
    requestId: string,
    includeThumbnails = false
  ): Promise<string[]> {
    const prefixes: string[] = [...REQUEST_MEDIA_PREFIXES];
    if (includeThumbnails) prefixes.push(THUMBNAIL_PREFIX);

    const marker = `/${requestId}/`;
    const keys: string[] = [];

    for (const prefix of prefixes) {
      let continuationToken: string | undefined;
      do {
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: `${prefix}/${userId}/`,
            ContinuationToken: continuationToken,
          })
        );
        for (const obj of res.Contents ?? []) {
          if (obj.Key && obj.Key.includes(marker)) keys.push(obj.Key);
        }
        continuationToken = res.IsTruncated
          ? res.NextContinuationToken
          : undefined;
      } while (continuationToken);
    }

    return keys;
  }

  /**
   * Delete every media object for a request (thumbnails kept by default).
   * Idempotent: deleting already-absent keys is a no-op.
   */
  async purgeRequestMedia(options: PurgeOptions): Promise<PurgeResult> {
    const { userId, requestId, keepThumbnails = true } = options;
    const keys = await this.listRequestKeys(userId, requestId, !keepThumbnails);

    const result: PurgeResult = { requestId, deletedKeys: [], errors: [] };
    if (keys.length === 0) return result;

    // DeleteObjects accepts up to 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
        })
      );
      for (const d of res.Deleted ?? []) {
        if (d.Key) result.deletedKeys.push(d.Key);
      }
      for (const e of res.Errors ?? []) {
        result.errors.push({ key: e.Key ?? "", message: e.Message ?? "unknown" });
      }
    }

    return result;
  }
}

export const storageLifecycleService = new StorageLifecycleService();
