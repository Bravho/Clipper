/**
 * Origin-owned byte snapshots of the files the user picked.
 *
 * ── The problem this exists to remove ──────────────────────────────────────
 *
 * A `File` handed to the page by `<input type="file">` is not bytes. It is a
 * *reference* to something the operating system owns, and on Android inside a
 * Capacitor WebView that reference is unusually fragile:
 *
 *   • the SAF / photo-picker `content://` grant is scoped to the Activity that
 *     received the picker result, and lapses when that Activity is recreated
 *     (rotation, a process trim while the app is backgrounded);
 *   • Blink caches `(size, lastModified)` at selection and re-validates it on
 *     every later read, so the MediaProvider merely re-stating the clip — which
 *     it does when it transcodes HEVC on the fly, or regenerates a thumbnail —
 *     invalidates it;
 *   • a media-pipeline teardown (a decoder that errors out on the file) drops
 *     the backing handle with it.
 *
 * All three surface identically, as `NotReadableError` thrown from
 * `slice().arrayBuffer()` — minutes after selection, in the middle of an
 * upload, with nothing to retry against, because the web layer cannot re-open a
 * `content://` URI whose grant it no longer holds. That is the failure users
 * saw as "some clips can never be uploaded, however many times I retry".
 *
 * ── The fix ────────────────────────────────────────────────────────────────
 *
 * Copy the bytes ONCE, at selection, while the picker's reference is as fresh
 * as it will ever be, into the origin private file system (OPFS). OPFS files
 * belong to the web origin, not to the OS media provider: nothing outside this
 * app can move, re-stat, transcode or revoke them, and they survive the
 * Activity being recreated. Every later read — the duration/poster probe, and
 * every part PUT — goes to that copy. The OS reference is never touched again
 * after the copy, so there is no window in which it can die.
 *
 * ── Why this is safe to fall back from ─────────────────────────────────────
 *
 * Everything here is best-effort and returns `null` when it cannot help: no
 * OPFS (older WebView), not enough quota for the batch, or a copy that itself
 * fails. Callers keep the original `File` in that case and behave exactly as
 * they did before this module existed. A snapshot can only make an upload more
 * likely to succeed, never less.
 */

import { describeError, diagLog, isUnreadableFileError } from "./uploadDiagnostics";

/** Directory inside OPFS. Namespaced so a future feature can share the origin. */
const SNAPSHOT_DIR = "rclipper-upload-snapshots";

/**
 * Copy granularity. Large enough that a 500 MB batch is a few thousand
 * iterations rather than a hundred thousand, small enough that peak heap stays
 * ~2× this regardless of file size — the whole point of not calling
 * `file.arrayBuffer()` on a 138 MB clip.
 */
const COPY_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Headroom multiplier required before snapshotting a batch. OPFS writes are not
 * transactional across files, and a quota error partway through leaves a
 * half-written copy that is worse than no copy — so refuse early with room to
 * spare rather than fail late.
 */
const QUOTA_HEADROOM = 1.5;

/**
 * Leftovers older than this are from a crashed or force-killed session and are
 * swept on mount. NOT "everything in the directory": a second form alive in
 * another tab would have its live snapshots deleted out from under it.
 */
const STALE_SNAPSHOT_MS = 6 * 60 * 60 * 1000;

/** A completed copy. `key` is the PendingFile id, so lookups need no extra map. */
export interface FileSnapshot {
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export function snapshotsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

async function snapshotDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(SNAPSHOT_DIR, { create: true });
}

/**
 * Is there room for `totalBytes` on top of what the origin already stores?
 *
 * `estimate()` is advisory — browsers round it and Chrome reports a quota that
 * is a fraction of free disk, not a reservation — so this is a guard against
 * the obviously-hopeless case (a nearly full phone), not a guarantee.
 */
async function hasRoomFor(totalBytes: number): Promise<boolean> {
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (quota === 0) return true; // No number to reason about; let the copy try.
    return quota - usage > totalBytes * QUOTA_HEADROOM;
  } catch {
    return true;
  }
}

/**
 * Copy one file into OPFS.
 *
 * Resolves to `null` on any failure, having already logged it — a failed
 * snapshot is a missed optimisation, not an error the caller must handle. The
 * one thing it does NOT swallow is an unreadable source: that is re-thrown as
 * the original error so the caller can tell the user at selection time, when
 * re-picking still costs them nothing, instead of after a long upload.
 */
export async function createSnapshot(
  key: string,
  file: File,
  /** Called after each chunk with the share copied so far, 0..1. */
  onProgress?: (fraction: number) => void
): Promise<FileSnapshot | null> {
  if (!snapshotsSupported()) return null;
  if (!(await hasRoomFor(file.size))) {
    diagLog("SNAPSHOT-SKIP", `${file.name} (insufficient origin quota)`);
    return null;
  }

  const startedAt = Date.now();
  let writable: FileSystemWritableFileStream | null = null;

  try {
    const dir = await snapshotDir();
    const handle = await dir.getFileHandle(key, { create: true });
    writable = await handle.createWritable();

    for (let offset = 0; offset < file.size; offset += COPY_CHUNK_BYTES) {
      const end = Math.min(offset + COPY_CHUNK_BYTES, file.size);
      // The ONLY place the original OS reference is read. If it is already dead
      // this throws here, at selection, which is exactly where we want it.
      const chunk = await file.slice(offset, end).arrayBuffer();
      await writable.write(chunk);
      onProgress?.(file.size > 0 ? end / file.size : 1);
    }

    await writable.close();
    writable = null;

    diagLog(
      "SNAPSHOT-OK",
      `${file.name} ${(file.size / 1e6).toFixed(1)}MB in ${Date.now() - startedAt}ms`
    );
    return { key, name: file.name, size: file.size, type: file.type };
  } catch (err) {
    // Never leave a partial copy behind: a short file would be uploaded as-is
    // and the request would be assembled from truncated bytes.
    if (writable) {
      try {
        await writable.abort();
      } catch {
        /* the stream is already gone */
      }
    }
    await deleteSnapshot(key);

    if (isUnreadableFileError(err)) {
      diagLog("SNAPSHOT-DEAD-SOURCE", `${file.name} ${describeError(err)}`);
      throw err;
    }
    diagLog("SNAPSHOT-FAIL", `${file.name} ${describeError(err)}`);
    return null;
  }
}

/** The snapshot as a `File`, for anything that wants a whole-file source. */
export async function snapshotFile(snapshot: FileSnapshot): Promise<File> {
  const dir = await snapshotDir();
  const handle = await dir.getFileHandle(snapshot.key);
  const stored = await handle.getFile();
  // Re-wrap so the name and MIME type survive: OPFS stores neither, and the
  // video probe keys off `type` to decide whether it can decode at all.
  return new File([stored], snapshot.name, { type: snapshot.type });
}

/** One byte range of the snapshot, as a `Blob` ready to PUT. */
export async function readSnapshotRange(
  snapshot: FileSnapshot,
  start: number,
  end: number
): Promise<Blob> {
  const dir = await snapshotDir();
  const handle = await dir.getFileHandle(snapshot.key);
  const stored = await handle.getFile();
  return stored.slice(start, end);
}

/** Best-effort removal. A snapshot that outlives its upload is swept later. */
export async function deleteSnapshot(key: string): Promise<void> {
  if (!snapshotsSupported()) return;
  try {
    const dir = await snapshotDir();
    await dir.removeEntry(key);
  } catch {
    /* never existed, or already gone */
  }
}

/**
 * Delete copies left behind by a session that was killed mid-upload.
 *
 * Age-based rather than "delete everything not currently pending", so a form
 * open in another tab keeps its snapshots. Silent: this is housekeeping, and a
 * failure here costs nothing but disk.
 */
export async function sweepStaleSnapshots(): Promise<void> {
  if (!snapshotsSupported()) return;
  try {
    const dir = await snapshotDir();
    // `values()` is an async iterator on the directory handle. Guard for the
    // WebViews that expose OPFS without it rather than throwing on mount.
    const entries = (dir as unknown as {
      values?: () => AsyncIterableIterator<FileSystemHandle>;
    }).values;
    if (typeof entries !== "function") return;

    const cutoff = Date.now() - STALE_SNAPSHOT_MS;
    let swept = 0;
    for await (const entry of entries.call(dir)) {
      if (entry.kind !== "file") continue;
      try {
        const stored = await (entry as FileSystemFileHandle).getFile();
        if (stored.lastModified < cutoff) {
          await dir.removeEntry(entry.name);
          swept += 1;
        }
      } catch {
        /* raced with another sweep */
      }
    }
    if (swept > 0) console.info(`[upload] swept ${swept} stale upload snapshot(s)`);
  } catch {
    /* OPFS unavailable in this context */
  }
}
