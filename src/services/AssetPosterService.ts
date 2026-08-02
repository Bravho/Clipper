/**
 * AssetPosterService — the ONE place that puts a poster still on a video asset.
 *
 * WHY THIS EXISTS. Poster generation used to live inline in a single pipeline
 * method (`_renderCaptionedRatio`), so every other route that produces a video —
 * the `finalExport_*` masters from `_composeRatioExport`, the on-demand Travy
 * compose — created assets with `thumbnailKey: ""`. Anything downstream that
 * keys off the thumbnail (the requester's distribution review, and the RClipper
 * Management library after transfer) then had nothing to show, and the failure
 * was invisible: a `console.error` and an empty string.
 *
 * CONTRACT.
 *   - IDEMPOTENT. An asset that already has a poster is returned untouched, so
 *     this is safe to call from a pipeline step, a retry, a transfer and a
 *     backfill without coordinating between them.
 *   - NEVER THROWS. A poster is a nicety; losing one must never discard a
 *     finished render or fail a transfer. Callers get `null` and carry on.
 *   - LOGGED UNDER ONE PREFIX. Every failure prints `[poster]` with the asset id
 *     and a classified reason, so "are posters failing in prod, and why" is a
 *     single grep rather than an archaeology exercise.
 *
 * COST. Generating a poster downloads the whole MP4 from Spaces and shells out
 * to ffmpeg. That is fine inside a worker claim; be deliberate about calling it
 * in a web request, and never fan it out in parallel across a project's ratios.
 */

import { uploadedAssetRepository } from "@/repositories/index";
import { buildThumbnailKey } from "@/lib/spacesKeys";
import type { UploadedAsset } from "@/domain/models/UploadedAsset";

export interface AssetPoster {
  /** Spaces object key of the JPEG still. */
  key: string;
  /** Public URL for that key. */
  url: string;
}

/**
 * Why a poster could not be produced. Distinguishing these matters: a missing
 * binary is an OPS problem (install ffmpeg on that box), whereas a decode error
 * is a MEDIA problem (a specific clip is broken). Collapsing both into "failed"
 * is what made the original bug so hard to see.
 */
export type PosterFailureReason =
  | "asset_not_found"
  | "no_storage_key"
  | "storage_not_configured"
  | "ffmpeg_missing"
  | "generation_failed"
  | "persist_failed";

/** ENOENT from `execFile` means the binary itself is not on this machine. */
function isBinaryMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT";
}

function classify(err: unknown): PosterFailureReason {
  return isBinaryMissing(err) ? "ffmpeg_missing" : "generation_failed";
}

function logFailure(assetId: string, reason: PosterFailureReason, err?: unknown) {
  // Expected wherever storage is deliberately absent (tests, local dev) — noting
  // it once at debug level keeps real failures visible in the error stream.
  if (reason === "storage_not_configured") {
    console.debug(`[poster] asset=${assetId} reason=storage_not_configured (skipped)`);
    return;
  }
  if (reason === "ffmpeg_missing") {
    console.error(
      `[poster] asset=${assetId} reason=ffmpeg_missing — ffmpeg is not installed on this host ` +
        `(set FFMPEG_PATH or install it); the clip is fine, only its preview image is missing.`
    );
    return;
  }
  console.error(`[poster] asset=${assetId} reason=${reason}`, err ?? "");
}

/** A video asset whose bytes are present and whose poster is still missing. */
function needsPoster(asset: UploadedAsset): boolean {
  return !asset.thumbnailKey;
}

/**
 * Ensure `assetId` has a poster still, generating one if it does not.
 *
 * @param baseName Optional label folded into the thumbnail key, for humans
 *                 reading the bucket (e.g. `poster-16x9`). Defaults to the
 *                 asset's ratio, then to `poster`.
 * @returns The poster's key + URL, or `null` when one could not be produced.
 */
export async function ensureAssetPoster(
  assetId: string,
  baseName?: string
): Promise<AssetPoster | null> {
  // Without a bucket there is nowhere to put a poster, and the S3 client would
  // spend its full retry budget discovering that. This keeps the unit suite (and
  // any environment without storage configured) from doing pointless network I/O
  // on every export, rather than making each caller remember to stub it.
  if (!process.env.DO_SPACES_BUCKET) {
    logFailure(assetId, "storage_not_configured");
    return null;
  }

  let asset: UploadedAsset | null = null;
  try {
    asset = await uploadedAssetRepository.findById(assetId);
  } catch (err) {
    logFailure(assetId, "asset_not_found", err);
    return null;
  }

  if (!asset) {
    logFailure(assetId, "asset_not_found");
    return null;
  }

  // Already has one — the common case on retries and repeat transfers.
  if (!needsPoster(asset)) {
    return { key: asset.thumbnailKey, url: asset.thumbnailUrl };
  }

  if (!asset.storageKey) {
    logFailure(assetId, "no_storage_key");
    return null;
  }

  const label =
    baseName ??
    (asset.videoRatio ? `poster-${asset.videoRatio.replace(":", "x")}` : "poster");
  const key = buildThumbnailKey(asset.userId, asset.requestId, label);

  let url: string;
  try {
    // `sharp` and the Spaces client are pulled in lazily: this module is imported
    // by request-path code (the transfer service), and neither belongs in that
    // module graph until a poster is actually being made. Loading `sharp` is a
    // native binding and can itself fail, so it sits inside the guard.
    const [{ generateVideoThumbnail }, { spacesPublicUrl }] = await Promise.all([
      import("@/lib/thumbnails"),
      import("@/lib/spaces"),
    ]);
    await generateVideoThumbnail(asset.storageKey, key);
    url = spacesPublicUrl(key);
  } catch (err) {
    logFailure(assetId, classify(err), err);
    return null;
  }

  // The bytes are in the bucket; if we cannot record where, the poster is
  // orphaned but harmless (the thumbnails/ prefix has a 730-day backstop).
  try {
    await uploadedAssetRepository.update(asset.id, {
      thumbnailKey: key,
      thumbnailUrl: url,
    });
  } catch (err) {
    logFailure(assetId, "persist_failed", err);
    return null;
  }

  return { key, url };
}

