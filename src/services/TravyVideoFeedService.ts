/**
 * Read-model feed of Travy-destined videos, consumed by the Travy admin
 * "รีวิว RClipper วีดิโอ" page over `GET /api/travy/videos`.
 *
 * Scope: only jobs whose `final_export_travy_asset_id` is set — the EN+ZH
 * render produced specifically for Travy. Other ratio exports are out of scope.
 *
 * This is a reporting query spanning four tables (video_generation_jobs,
 * clip_requests, uploaded_assets, request_status_history), so it uses the
 * shared `pool` directly rather than an entity repository — the same approach
 * CreditService and ManagementAuditService take for cross-table reads.
 *
 * READ ONLY. This service never writes, and requires no schema changes.
 */

import { pool } from "@/lib/db";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  spacesClient,
  spacesSignedUrl,
  spacesPublicUrl,
  SPACES_BUCKET,
} from "@/lib/spaces";
import { FINAL_CLIP_AVAILABILITY_DAYS, addDays } from "@/config/retention";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { AssetUploadStatus } from "@/domain/enums/AssetType";

/** Whether the object still exists in the Space. */
export type SpacesStatus = "available" | "deleted" | "unknown";

export interface TravyVideoLocation {
  lat: number;
  lng: number;
  label: string | null;
}

export interface TravyVideoItem {
  id: string;
  requestId: string;
  title: string;
  description: string;
  /** Presigned GET URL (1 h TTL). Null when the object is gone. */
  videoUrl: string | null;
  /** Thumbnails are public objects, so a plain public URL is fine. */
  thumbnailUrl: string | null;
  /** Where thumbnailUrl came from — useful when a card renders with no preview. */
  thumbnailSource: "asset" | "draft" | "source_upload" | "none";
  generatedAt: string | null;
  /** Delivery + FINAL_CLIP_AVAILABILITY_DAYS. Null until the request is delivered. */
  expiresAt: string | null;
  durationSeconds: number | null;
  location: TravyVideoLocation | null;
  spacesStatus: SpacesStatus;
  /** RClipper's own view of the Travy render: idle | generating | ready | failed. */
  travyVideoStatus: string | null;
  /** Where the requester published it, if anywhere (from publishing drafts). */
  publishedUrls: string[];
}

export interface TravyVideoPage {
  items: TravyVideoItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListTravyVideosParams {
  page?: number;
  limit?: number;
  /** "available" | "deleted" — filters on the live Spaces check. */
  status?: string;
}

export const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const HEAD_TIMEOUT_MS = 5000;

/**
 * Does the object still exist in our Space?
 *
 * A 404 is a real deletion. Anything else (network blip, throttle, permission
 * hiccup) returns "unknown" — never "deleted", because falsely telling a Travy
 * admin that a clip is gone is worse than admitting we could not tell.
 */
async function checkSpacesStatus(key: string | null): Promise<SpacesStatus> {
  if (!key) return "unknown";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);

  try {
    await spacesClient.send(
      new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
      { abortSignal: controller.signal }
    );
    return "available";
  } catch (err: unknown) {
    const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
    const code = e?.$metadata?.httpStatusCode;
    if (code === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") {
      return "deleted";
    }
    console.warn(`[TravyVideoFeed] HEAD failed for ${key}:`, e?.name ?? err);
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/** Safely parse a publishing_drafts blob into an array. Never throws. */
function parseDrafts(raw: unknown): Array<Record<string, unknown>> {
  if (!raw) return [];
  try {
    const drafts = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(drafts)
      ? (drafts.filter((d) => !!d && typeof d === "object") as Array<
          Record<string, unknown>
        >)
      : [];
  } catch {
    return [];
  }
}

/**
 * First per-channel preview image the pipeline already computed.
 *
 * These are poster frames extracted from the captioned export, so they are the
 * right picture — no extra work needed to reuse one here.
 */
function draftPreviewUrl(raw: unknown): string | null {
  for (const d of parseDrafts(raw)) {
    const url = d.previewImageUrl;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

/**
 * Pull the published post URLs out of a job's publishingDrafts JSON.
 * Tolerates legacy/malformed rows — a bad blob yields an empty list, not a throw.
 */
function extractPublishedUrls(raw: unknown): string[] {
  return parseDrafts(raw)
    .filter((d) => d.status === "posted" && typeof d.url === "string" && d.url)
    .map((d) => d.url as string);
}

/**
 * Resolve a preview image for one row, in descending order of fidelity.
 * Read-only: never generates a poster (that needs ffmpeg and a bucket write,
 * which has no place in a listing endpoint).
 *
 *   1. the Travy export's own poster    — exactly this video, right ratio
 *   2. a channel draft's preview image  — poster frame of the captioned export
 *   3. a source image the requester uploaded — right subject, wrong framing
 *
 * `thumbnailSource` is returned alongside so an empty card is diagnosable
 * ("none" means ensureAssetPoster failed AND there is no source thumbnail).
 */
function resolveThumbnail(row: Record<string, unknown>): {
  url: string | null;
  source: "asset" | "draft" | "source_upload" | "none";
} {
  const assetKey = (row.thumbnail_key as string) || "";
  if (assetKey) return { url: spacesPublicUrl(assetKey), source: "asset" };

  const assetUrl = (row.thumbnail_url as string) || "";
  if (assetUrl) return { url: assetUrl, source: "asset" };

  const fromDraft = draftPreviewUrl(row.publishing_drafts);
  if (fromDraft) return { url: fromDraft, source: "draft" };

  const srcKey = (row.src_thumbnail_key as string) || "";
  if (srcKey) return { url: spacesPublicUrl(srcKey), source: "source_upload" };

  const srcUrl = (row.src_thumbnail_url as string) || "";
  if (srcUrl) return { url: srcUrl, source: "source_upload" };

  return { url: null, source: "none" };
}

/**
 * One page of Travy-destined videos, newest first.
 *
 * `status` filtering happens after the live Spaces check, which cannot be done
 * in SQL. To keep the filter honest without scanning the whole table, filtered
 * queries fetch a bounded window (10 pages' worth) and paginate in memory;
 * unfiltered queries paginate in SQL as normal.
 */
export async function listTravyVideos(
  params: ListTravyVideosParams = {}
): Promise<TravyVideoPage> {
  const page = Math.max(1, Math.trunc(params.page ?? 1) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(params.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
  );
  const statusFilter =
    params.status === "available" || params.status === "deleted"
      ? params.status
      : null;

  // The Travy export asset, its request, and the moment the request was
  // delivered (earliest 'delivered' history row drives the 7-day window).
  const baseSelect = `
    SELECT
      j.id                              AS job_id,
      j.request_id                      AS request_id,
      j.travy_video_status              AS travy_video_status,
      j.publishing_drafts               AS publishing_drafts,
      j.updated_at                      AS job_updated_at,
      a.id                              AS asset_id,
      a.storage_key                     AS storage_key,
      a.thumbnail_key                   AS thumbnail_key,
      a.thumbnail_url                   AS thumbnail_url,
      a.duration_seconds                AS duration_seconds,
      a.upload_status                   AS upload_status,
      a.created_at                      AS asset_created_at,
      r.title                           AS title,
      r.description                     AS description,
      r.place_name                      AS place_name,
      r.latitude                        AS latitude,
      r.longitude                       AS longitude,
      h.delivered_at                    AS delivered_at,
      src.thumbnail_key                 AS src_thumbnail_key,
      src.thumbnail_url                 AS src_thumbnail_url
    FROM video_generation_jobs j
    -- EVERY side of these joins is cast to ::text, on purpose.
    --
    -- The live column types are not knowable from the migration files. 004
    -- declares video_generation_jobs.request_id as TEXT, but the deployed
    -- database has it as UUID; and migration 019 explicitly branches on
    -- whether uploaded_assets.id is 'uuid' or 'text', proving the types differ
    -- between environments. Casting only one side therefore fixes one
    -- deployment and breaks another.
    --
    -- text = text is valid whatever the underlying types are. status is cast
    -- too, in case it is an enum rather than TEXT in some environment.
    JOIN uploaded_assets a
      ON a.id::text = j.final_export_travy_asset_id::text
    JOIN clip_requests r
      ON r.id::text = j.request_id::text
    LEFT JOIN LATERAL (
      SELECT MIN(sh.changed_at) AS delivered_at
      FROM request_status_history sh
      WHERE sh.request_id::text = j.request_id::text
        AND sh.status::text = $1::text
    ) h ON TRUE
    -- Last-resort preview: a thumbnail from the requester's own source material.
    -- Prefers a still image over a video's poster frame, which mirrors the
    -- precedence VideoGenerationService already uses when it picks a channel
    -- preview image. Only rows that actually have a thumbnail are considered.
    LEFT JOIN LATERAL (
      SELECT sa.thumbnail_key, sa.thumbnail_url
      FROM uploaded_assets sa
      WHERE sa.request_id::text = j.request_id::text
        AND COALESCE(sa.thumbnail_key, '') <> ''
        AND sa.asset_type::text IN ('image', 'video')
      ORDER BY (sa.asset_type::text = 'image'::text) DESC, sa.created_at ASC
      LIMIT 1
    ) src ON TRUE
    WHERE j.final_export_travy_asset_id IS NOT NULL
    ORDER BY a.created_at DESC
  `;

  // Without a status filter we can page in SQL and count cheaply.
  if (!statusFilter) {
    const countResult = await pool.query(
      // Both sides of every join cast to ::text — see the comment in baseSelect.
      `SELECT COUNT(*)::int AS n
       FROM video_generation_jobs j
       JOIN uploaded_assets a
         ON a.id::text = j.final_export_travy_asset_id::text
       JOIN clip_requests r
         ON r.id::text = j.request_id::text
       WHERE j.final_export_travy_asset_id IS NOT NULL`
    );
    const total: number = countResult.rows[0]?.n ?? 0;

    const offset = (page - 1) * limit;
    const rowsResult = await pool.query(
      `${baseSelect} LIMIT $2 OFFSET $3`,
      [RequestStatus.Delivered, limit, offset]
    );

    const items = await hydrateRows(rowsResult.rows);
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // Filtered: hydrate a bounded window, then filter and slice in memory.
  const windowSize = limit * 10;
  const rowsResult = await pool.query(`${baseSelect} LIMIT $2`, [
    RequestStatus.Delivered,
    windowSize,
  ]);

  const hydrated = await hydrateRows(rowsResult.rows);
  const filtered = hydrated.filter((i) => i.spacesStatus === statusFilter);
  const total = filtered.length;
  const start = (page - 1) * limit;

  return {
    items: filtered.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Turn raw rows into API items: live Spaces status, presigned playback URL,
 * public thumbnail URL, and the delivery-based expiry date.
 *
 * All per-row async work runs in parallel and is failure-isolated, so one bad
 * object cannot fail the whole page.
 */
async function hydrateRows(
  rows: Record<string, unknown>[]
): Promise<TravyVideoItem[]> {
  return Promise.all(
    rows.map(async (row) => {
      const storageKey = (row.storage_key as string) || null;
      const thumbnail = resolveThumbnail(row);

      // An asset already marked deleted in our own records needs no HEAD call.
      const markedDeleted = row.upload_status === AssetUploadStatus.Deleted;
      const spacesStatus: SpacesStatus = markedDeleted
        ? "deleted"
        : await checkSpacesStatus(storageKey);

      let videoUrl: string | null = null;
      if (spacesStatus === "available" && storageKey) {
        try {
          videoUrl = await spacesSignedUrl(storageKey);
        } catch (err) {
          console.warn("[TravyVideoFeed] presign failed:", err);
        }
      }

      const deliveredAt = row.delivered_at
        ? new Date(row.delivered_at as string)
        : null;
      const expiresAt = deliveredAt
        ? addDays(deliveredAt, FINAL_CLIP_AVAILABILITY_DAYS)
        : null;

      const lat = row.latitude != null ? Number(row.latitude) : null;
      const lng = row.longitude != null ? Number(row.longitude) : null;
      const hasLocation =
        lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

      const generatedAt = (row.asset_created_at ??
        row.job_updated_at) as Date | null;

      return {
        id: String(row.asset_id ?? row.job_id),
        requestId: String(row.request_id ?? ""),
        title: (row.title as string) || "ไม่มีชื่อวีดิโอ",
        description: (row.description as string) || "",
        videoUrl,
        thumbnailUrl: thumbnail.url,
        thumbnailSource: thumbnail.source,
        generatedAt: generatedAt ? new Date(generatedAt).toISOString() : null,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        durationSeconds:
          row.duration_seconds != null ? Number(row.duration_seconds) : null,
        location: hasLocation
          ? { lat: lat!, lng: lng!, label: (row.place_name as string) || null }
          : null,
        spacesStatus,
        travyVideoStatus: (row.travy_video_status as string) ?? null,
        publishedUrls: extractPublishedUrls(row.publishing_drafts),
      };
    })
  );
}
