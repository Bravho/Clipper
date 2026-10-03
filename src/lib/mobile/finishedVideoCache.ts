"use client";

import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

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
 * CLEAN-UP. Copies older than `KEEP_DAYS` are removed (the server keeps a
 * delivered video's download for 7 days), and the folder is trimmed to
 * `MAX_BYTES` (0.8 GB), oldest first, whenever the studio opens and after each save.
 */

const FOLDER = "rclipper-finished-videos";
const KEEP_DAYS = 8;
const MAX_BYTES = 800_000_000;

function available(): boolean {
  return Capacitor.isNativePlatform();
}

function nameFor(assetId: string): string {
  return `${FOLDER}/${assetId.replace(/[^a-zA-Z0-9._-]/g, "_")}.mp4`;
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

/** Remove copies past their time, then trim the folder to its size limit. */
export async function sweepFinishedVideos(now: number = Date.now()): Promise<void> {
  if (!available()) return;
  try {
    const { files } = await Filesystem.readdir({ path: FOLDER, directory: Directory.Data });
    const entries = files
      .filter((file) => file.type === "file")
      .map((file) => ({
        name: file.name,
        size: Number(file.size) || 0,
        mtime: Number(file.mtime) || 0,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    const cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
    let total = 0;
    for (const entry of entries) {
      total += entry.size;
      const expired = entry.mtime > 0 && entry.mtime < cutoff;
      if (expired || total > MAX_BYTES) {
        total -= entry.size;
        await Filesystem.deleteFile({
          path: `${FOLDER}/${entry.name}`,
          directory: Directory.Data,
        }).catch(() => undefined);
      }
    }
  } catch {
    // No folder yet, or nothing readable: nothing to clean.
  }
}
