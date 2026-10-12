/**
 * ManagementUploadService — the user's own videos.
 *
 * This is what makes RClipper Management useful on its own, rather than only as
 * an extension of the video generator: a user can bring any video, and use
 * Management purely as a convenient way to publish to several channels at once
 * and keep track of what went where.
 *
 * UPLOADING NEEDS A PACKAGE (2026-10-12). Only an account holding a live
 * package may upload, up to MANAGEMENT_UPLOAD_KEEP_LIMIT (50) videos kept at
 * once; each upload is kept VIDEO_LIFETIME_DAYS (30). A free account uploads
 * nothing.
 *
 * Two-step flow, mirroring the existing clip-request upload:
 *   1. `begin()`   — validate, create the content item, return a presigned PUT
 *                    URL. The browser uploads DIRECTLY to Spaces, so large video
 *                    files never pass through the web server.
 *   2. `complete()`— verify the object really landed, record the asset row, and
 *                    flip the item to `ready`.
 *
 * A begun-but-never-completed upload stays in `uploading` and is swept by its
 * media-expiry window like any other item, so an abandoned upload cannot leave a
 * permanently half-created record.
 */

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { spacesClient, SPACES_BUCKET } from "@/lib/spaces";
import { buildManagementRetainedKey } from "@/lib/spacesKeys";
import { VIDEO_LIFETIME_DAYS, addDays } from "@/config/retention";
import {
  videoAccessService,
  type VideoAccessService,
} from "@/services/VideoAccessService";
import { managementContentRepository } from "@/repositories";
import { managementAuditService } from "@/services/management/ManagementAuditService";
import {
  ManagementContentStatus,
  ManagementSourceType,
} from "@/domain/enums/ManagementStatus";
import type { ManagementContentItem } from "@/domain/models/ManagementContent";

/**
 * Accepted upload formats.
 *
 * Kept deliberately narrow to the containers the social platforms actually
 * accept, so a user finds out at upload time rather than at publish time —
 * after they have paid.
 */
export const MANAGEMENT_UPLOAD_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
] as const;

/** Upper bound on a single uploaded video. Default 300 MB (env-overridable). */
export const MANAGEMENT_UPLOAD_MAX_BYTES = Number(
  process.env.RCLIPPER_MANAGEMENT_UPLOAD_MAX_BYTES ?? String(300 * 1024 * 1024)
);

/**
 * How many uploaded videos a package holder may keep at once (Tho,
 * 2026-10-12). High enough that a business posting every day never meets it;
 * it only stops the bucket being used as free video hosting. Deleting one, or
 * one expiring, frees a place. Env-overridable.
 */
export const MANAGEMENT_UPLOAD_KEEP_LIMIT = Number(
  process.env.RCLIPPER_MANAGEMENT_UPLOAD_KEEP_LIMIT ?? "50"
);

/**
 * Expiry for an uploaded file created now: VIDEO_LIFETIME_DAYS (30), the same
 * as every other video. The file is written straight into
 * `management_retained/`, whose bucket lifecycle rule is the 30-day backstop.
 */
export function managementUploadExpiryFrom(from: Date = new Date()): Date {
  return addDays(from, VIDEO_LIFETIME_DAYS);
}

/** How long the presigned PUT stays usable. Generous, for slow mobile uploads. */
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

export class ManagementUploadError extends Error {
  constructor(
    readonly code:
      | "unsupported_type"
      | "too_large"
      | "empty_file"
      | "not_owner"
      | "not_uploading"
      | "object_missing"
      | "size_mismatch"
      | "quota_exceeded"
      | "package_required",
    message: string
  ) {
    super(message);
    this.name = "ManagementUploadError";
  }
}

export interface BeginUploadResult {
  content: ManagementContentItem;
  /** Presigned PUT URL — the browser uploads straight to Spaces with this. */
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export class ManagementUploadService {
  constructor(
    private content = managementContentRepository,
    private audit = managementAuditService,
    private s3 = spacesClient,
    private access: Pick<VideoAccessService, "hasActivePackage"> = videoAccessService
  ) {}

  /**
   * Validate and start an upload.
   *
   * Validation happens BEFORE the presigned URL is issued, so an unsupported or
   * oversized file is rejected without any bytes moving.
   */
  async begin(params: {
    userId: string;
    title: string;
    description?: string | null;
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
  }): Promise<BeginUploadResult> {
    const mime = params.mimeType.toLowerCase().split(";")[0].trim();
    if (!(MANAGEMENT_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new ManagementUploadError(
        "unsupported_type",
        `Unsupported video format. Accepted: ${MANAGEMENT_UPLOAD_MIME_TYPES.join(", ")}.`
      );
    }
    if (!Number.isFinite(params.fileSizeBytes) || params.fileSizeBytes <= 0) {
      throw new ManagementUploadError("empty_file", "File is empty.");
    }
    if (params.fileSizeBytes > MANAGEMENT_UPLOAD_MAX_BYTES) {
      throw new ManagementUploadError(
        "too_large",
        `File is larger than the ${Math.floor(
          MANAGEMENT_UPLOAD_MAX_BYTES / (1024 * 1024)
        )} MB limit.`
      );
    }

    // Uploading is part of a package: no package, no upload.
    if (!(await this.access.hasActivePackage(params.userId))) {
      throw new ManagementUploadError(
        "package_required",
        "Buy a package to upload videos to Channel Management."
      );
    }

    // Cap how many uploaded videos are kept at once. Only uploads still holding
    // media count — an expired, purged or cancelled one has freed its place.
    // Transfers from the studio do not count.
    const live = await this.content.findByUserId(params.userId);
    const now = Date.now();
    const keptCount = live.filter(
      (i) =>
        i.sourceType === ManagementSourceType.UserUpload &&
        i.mediaDeletedAt === null &&
        i.status !== ManagementContentStatus.Cancelled &&
        i.status !== ManagementContentStatus.MediaExpired &&
        (!i.mediaExpiresAt || i.mediaExpiresAt.getTime() > now)
    ).length;
    if (keptCount >= MANAGEMENT_UPLOAD_KEEP_LIMIT) {
      throw new ManagementUploadError(
        "quota_exceeded",
        `You can keep up to ${MANAGEMENT_UPLOAD_KEEP_LIMIT} uploaded videos at once. Delete one to upload another.`
      );
    }

    const item = await this.content.createUploaded({
      userId: params.userId,
      title: params.title.trim() || params.fileName,
      description: params.description ?? null,
      mediaExpiresAt: managementUploadExpiryFrom(),
    });

    // Straight into the paid prefix (30-day bucket rule): every uploader holds
    // a package, so there is no free 7-day stage to move it out of later.
    const storageKey = buildManagementRetainedKey(
      params.userId,
      item.id,
      params.fileName
    );

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: storageKey,
        ContentType: mime,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS }
    );

    await this.audit.record("management.upload.started", {
      userId: params.userId,
      managementContentId: item.id,
      metadata: {
        mimeType: mime,
        fileSizeBytes: params.fileSizeBytes,
        mediaExpiresAt: item.mediaExpiresAt?.toISOString() ?? null,
      },
    });

    return {
      content: item,
      uploadUrl,
      storageKey,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /**
   * Finish an upload once the browser's PUT has succeeded.
   *
   * The object is verified server-side with a HEAD before anything is recorded —
   * a client claiming "upload done" is not evidence that it is, and a content
   * item must never reach `ready` pointing at a key that does not exist.
   */
  async complete(params: {
    userId: string;
    managementContentId: string;
    storageKey: string;
    durationSeconds?: number | null;
    width?: number | null;
    height?: number | null;
    originalFilename?: string | null;
    /** Poster frame captured in the browser, as a base64 image data URL. */
    posterDataUrl?: string | null;
  }): Promise<ManagementContentItem> {
    const item = await this.content.findById(params.managementContentId);
    if (!item) throw new ManagementUploadError("not_owner", "Upload not found.");
    if (item.userId !== params.userId) {
      throw new ManagementUploadError("not_owner", "Access denied.");
    }

    // Already completed — treat as success so a retried confirm is harmless.
    if (item.status !== ManagementContentStatus.Uploading) {
      return item;
    }

    // The key must be the one we issued for THIS item, or a user could point a
    // content item at somebody else's object.
    // `management_uploads/` is what uploads begun before 2026-10-12 were given.
    const expectedPrefixes = [
      `management_retained/${params.userId}/${item.id}/`,
      `management_uploads/${params.userId}/${item.id}/`,
    ];
    if (!expectedPrefixes.some((prefix) => params.storageKey.startsWith(prefix))) {
      throw new ManagementUploadError("not_owner", "Storage key does not belong to this upload.");
    }

    let contentLength: number | null = null;
    let contentType: string | null = null;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: params.storageKey })
      );
      contentLength = head.ContentLength ?? null;
      contentType = head.ContentType ?? null;
    } catch {
      throw new ManagementUploadError(
        "object_missing",
        "The uploaded file could not be found in storage."
      );
    }

    if (contentLength !== null && contentLength <= 0) {
      throw new ManagementUploadError("empty_file", "The uploaded file is empty.");
    }
    if (contentLength !== null && contentLength > MANAGEMENT_UPLOAD_MAX_BYTES) {
      throw new ManagementUploadError("too_large", "The uploaded file exceeds the size limit.");
    }

    const aspectRatio =
      params.width && params.height ? simplifyRatio(params.width, params.height) : null;

    await this.content.replaceAssets(item.id, [
      {
        // No uploaded_assets row: an uploaded video has no clip request, so the
        // storage key is the identity.
        sourceVideoId: null,
        platformVariant: "original",
        storageKey: params.storageKey,
        mimeType: contentType,
        width: params.width ?? null,
        height: params.height ?? null,
        durationSeconds: params.durationSeconds ?? null,
        aspectRatio,
        originalFilename: params.originalFilename ?? null,
        fileSizeBytes: contentLength,
      },
    ]);

    // Store the browser-captured poster so an uploaded video shows a preview
    // image in the library exactly like a transferred one. Strictly best-effort:
    // a failure here must not undo an upload that has already landed, so the
    // item still goes to `ready` with no thumbnail.
    const thumbnailStorageKey = await this._storePoster(
      params.userId,
      item.id,
      params.posterDataUrl ?? null
    );
    if (thumbnailStorageKey) {
      await this.content
        .update(item.id, { thumbnailStorageKey })
        .catch((err) => console.error(`[poster] upload item=${item.id} persist failed`, err));
    }

    const ready = await this.content.updateStatus(item.id, ManagementContentStatus.Ready);

    await this.audit.record("management.upload.completed", {
      userId: params.userId,
      managementContentId: item.id,
      metadata: { fileSizeBytes: contentLength, mimeType: contentType, aspectRatio },
    });

    return ready;
  }

  /**
   * Resize, compress and store a browser-captured poster; returns its Spaces key
   * or null when there is nothing to store or storing failed.
   *
   * `storePosterThumbnail` is imported lazily because it pulls in `sharp`, a
   * native module with no business in the module graph of an upload request that
   * may carry no poster at all.
   */
  private async _storePoster(
    userId: string,
    contentId: string,
    posterDataUrl: string | null
  ): Promise<string | null> {
    if (!posterDataUrl) return null;
    try {
      const [{ storePosterThumbnail }, { buildThumbnailKey }] = await Promise.all([
        import("@/lib/thumbnails"),
        import("@/lib/spacesKeys"),
      ]);
      // The content item id stands in for the request id: an uploaded video has
      // no clip request, and this keeps every poster under the one `thumbnails/`
      // prefix (public, exempt from the app purge, 730-day backstop).
      const key = buildThumbnailKey(userId, contentId, "poster-upload");
      await storePosterThumbnail(posterDataUrl, key);
      return key;
    } catch (err) {
      console.error(`[poster] upload item=${contentId} reason=generation_failed`, err);
      return null;
    }
  }
}

/** Reduce a pixel size to a display ratio like "9:16". */
function simplifyRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export const managementUploadService = new ManagementUploadService();
