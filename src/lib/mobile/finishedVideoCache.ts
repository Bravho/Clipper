"use client";

import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

/**
 * Finished videos kept on the phone that made them, so "Download" is instant.
 *
 * WHY. The phone renders a video, uploads it, and the render plugin then
 * deletes its working copy. Downloading it afterwards meant fetching the same
 * 30–80 MB back from the server. Now a captioned video (a render's `final`
 * stage) is copied into the app's own storage — keyed by the asset id the
 * server gave it — before the working copy goes, and Download saves that copy.
 * The server download stays as the fallback: a video made on another phone,
 * after a reinstall, or once this copy was cleaned away.
 *
 * Only the Filesystem plugin is used, which every app build already has, so
 * this needs no new app build.
 *
 * CLEAN-UP — THE SAME DATE AS THE SERVER (Tho, 2026-10-12). Each copy is
 * deleted on its video's expiry date, the one the studio shows
 * (`clip_requests.videos_expire_at`: 14 days for a free video, 30 for a
 * package one, renewed by a purchase). The studio records that date here
 * every time it reads the request (`setFinishedVideoExpiry`), so the phone
 * never keeps a video the server has let go, nor drops one the server still
 * keeps. A copy whose date was never recorded is removed after
 * `FALLBACK_KEEP_DAYS` — the shortest lifetime, so it can never outlive the
 * server. The folder is also trimmed to `MAX_BYTES` (0.8 GB), oldest first;
 * a video trimmed early still downloads from the server until its date.
 * Runs whenever the studio opens and after each save.
 */

const FOLDER = "rclipper-finished-videos";
/** assetId → ISO expiry, written by the studio from the server's date. */
const INDEX = `${FOLDER}/expiry.json`;
/** For a copy with no recorded date: FREE_VIDEO_LIFETIME_DAYS, the shortest. */
const FALLBACK_KEEP_DAYS = 14;
const MAX_BYTES = 800_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type ExpiryIndex = Record<string, string>;

async function readIndex(): Promise<ExpiryIndex> {
  try {
    const { data } = await Filesystem.readFile({
      path: INDEX,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed: unknown = JSON.parse(typeof data === "string" ? data : "");
    return parsed && typeof parsed === "object" ? (parsed as ExpiryIndex) : {};
  } catch {
    return {};
  }
}

async function writeIndex(index: ExpiryIndex): Promise<void> {
  await Filesystem.mkdir({ path: FOLDER, directory: Directory.Data, recursive: true }).catch(
    () => undefined
  );
  await Filesystem.writeFile({
    path: INDEX,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(index),
  });
}

function keyFor(assetId: string): string {
  return assetId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function available(): boolean {
  return Capacitor.isNativePlatform();
}

function nameFor(assetId: string): string {
  return `${FOLDER}/${keyFor(assetId)}.mp4`;
}

function asFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

/**
 * Keep a copy of a finished video. Never throws: failing to keep a copy only
 * means the next download comes from the server, as before.
 */
export async function keepFinishedVideo(assetId: string | null | undefined, path: string): Promise<void> {
  if (!available() || !assetId || !path) return;
  try {
    await Filesystem.mkdir({ path: FOLDER, directory: Directory.Data, recursive: true }).catch(
      () => undefined
    );
    await Filesystem.deleteFile({ path: nameFor(assetId), directory: Directory.Data }).catch(
      () => undefined
    );
    await Filesystem.copy({
      from: asFileUri(path),
      to: nameFor(assetId),
      toDirectory: Directory.Data,
    });
    await sweepFinishedVideos();
  } catch {
    // The server copy is still there; nothing else to do.
  }
}

/** The kept copy's URI, or null when this phone has none. */
export async function finishedVideoUri(assetId: string): Promise<string | null> {
  if (!available()) return null;
  try {
    const stat = await Filesystem.stat({ path: nameFor(assetId), directory: Directory.Data });
    if (!stat || !(Number(stat.size) > 0)) return null;
    const { uri } = await Filesystem.getUri({ path: nameFor(assetId), directory: Directory.Data });
    return uri;
  } catch {
    return null;
  }
}

/**
 * Give the kept copy a readable name for the Save/Share sheet ("Café - TikTok.mp4")
 * without touching the kept file: a quick local copy into the cache.
 */
export async function shareableCopy(assetId: string, fileName: string): Promise<string | null> {
  const source = await finishedVideoUri(assetId);
  if (!source) return null;
  try {
    // A copy left from an earlier save would make the copy fail on some builds.
    await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(
      () => undefined
    );
    await Filesystem.copy({
      from: nameFor(assetId),
      directory: Directory.Data,
      to: fileName,
      toDirectory: Directory.Cache,
    });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
    return uri;
  } catch {
    // Sharing the kept file under its id is still better than a download.
    return source;
  }
}

/**
 * Record the server's expiry date for these finished videos (one request's
 * shapes share one date), so the phone deletes its copies on the same day.
 * A date already past deletes them now. Null (not delivered yet) records
 * nothing. Never throws.
 */
export async function setFinishedVideoExpiry(
  assetIds: string[],
  expiresAt: string | null | undefined,
  now: number = Date.now()
): Promise<void> {
  if (!available() || !expiresAt || assetIds.length === 0) return;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return;
  try {
    const index = await readIndex();
    let changed = false;
    for (const assetId of assetIds) {
      const key = keyFor(assetId);
      if (index[key] !== expiresAt) {
        index[key] = expiresAt;
        changed = true;
      }
    }
    if (changed) await writeIndex(index);
    if (at <= now) await sweepFinishedVideos(now);
  } catch {
    // The fallback age still applies; nothing else to do.
  }
}

/**
 * Remove copies past their video's expiry date (or, with no recorded date,
 * older than FALLBACK_KEEP_DAYS), then trim the folder to its size limit.
 */
export async function sweepFinishedVideos(now: number = Date.now()): Promise<void> {
  if (!available()) return;
  try {
    const { files } = await Filesystem.readdir({ path: FOLDER, directory: Directory.Data });
    const index = await readIndex();
    const entries = files
      .filter((file) => file.type === "file" && file.name.endsWith(".mp4"))
      .map((file) => ({
        name: file.name,
        key: file.name.slice(0, -".mp4".length),
        size: Number(file.size) || 0,
        mtime: Number(file.mtime) || 0,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    const fallbackCutoff = now - FALLBACK_KEEP_DAYS * DAY_MS;
    let total = 0;
    const kept = new Set<string>();
    for (const entry of entries) {
      total += entry.size;
      const recorded = index[entry.key] ? new Date(index[entry.key]).getTime() : NaN;
      const expired = Number.isFinite(recorded)
        ? recorded <= now
        : entry.mtime > 0 && entry.mtime < fallbackCutoff;
      if (expired || total > MAX_BYTES) {
        total -= entry.size;
        await Filesystem.deleteFile({
          path: `${FOLDER}/${entry.name}`,
          directory: Directory.Data,
        }).catch(() => undefined);
      } else {
        kept.add(entry.key);
      }
    }
    // Forget dates of copies that are gone, so the index does not grow forever.
    const stale = Object.keys(index).filter((key) => !kept.has(key));
    if (stale.length > 0) {
      for (const key of stale) delete index[key];
      await writeIndex(index).catch(() => undefined);
    }
  } catch {
    // No folder yet, or nothing readable: nothing to clean.
  }
}
