/**
 * Origin-private copies of picked upload files — "the vault".
 *
 * ── The problem this exists to solve ────────────────────────────────────────
 *
 * On Android, `<input type="file">` hands the WebView `File` objects backed by
 * a Storage Access Framework `content://` URI. Those references are far more
 * fragile than a desktop `File`:
 *
 *   • The read grant is bound to the Activity that received the picker Intent
 *     result. It is not persistable from the web layer, and it ends when the
 *     Activity is recreated or the provider client is torn down — which Android
 *     is free to do under memory pressure, exactly the condition a batch of 4K
 *     clips creates.
 *   • Blink records `(size, lastModified)` when the `File` is created and
 *     re-validates on every read. The gallery provider re-stats clips (this
 *     codebase already had to drop `lastModified` from `fileSig` for that very
 *     reason), so a snapshot can stop matching without anything being wrong
 *     with the file.
 *
 * Either way the read throws `NotReadableError`:
 *
 *     The requested file could not be read, typically due to permission
 *     problems that have occurred after a reference to a file was acquired.
 *
 * And it is terminal. The web layer cannot re-open a `content://` URI whose
 * grant it no longer holds, so every retry re-reads the same dead handle and
 * fails identically — which is what made a batch of clips look permanently
 * un-uploadable however many times the user pressed retry.
 *
 * The killer detail from the field report: a 4 MB JPEG failed with the same
 * error as a 70 MB HEVC clip in the same batch. Nothing about size, codec or
 * the network explains that. The handles died as a group.
 *
 * ── The fix ────────────────────────────────────────────────────────────────
 *
 * Copy the bytes into storage this origin owns, ONCE, at selection time while
 * the grant is certainly fresh, then never touch the original `File` again.
 * Uploads, part reads and the duration/poster probe all read the copy. OPFS
 * files have no grant to expire and no provider to re-stat them, so the whole
 * failure mode disappears rather than being retried around.
 *
 * The copy STREAMS (`file.stream()` → `FileSystemWritableFileStream`). It never
 * calls `arrayBuffer()` on a whole clip, so peak memory stays at one stream
 * chunk regardless of file size — this must not undo the bounded-memory work in
 * `materializeRange`, which exists because holding whole clips in memory got the
 * Android WebView killed.
 *
 * Vaulting is best-effort by design. Where OPFS is missing or the origin quota
 * cannot hold the batch, callers fall back to reading the original `File` — the
 * previous behaviour — and `isUnreadableFileError` is the safety net that turns
 * the resulting failure into something the user can act on instead of an
 * infinite retry loop.
 */

import { lsGet, lsRemove, lsSet } from "./draftStorage";

/** Subdirectory inside the origin-private filesystem. */
const VAULT_DIR = "upload-vault";

/** localStorage list of vault keys, so a session killed mid-upload can still be
 *  cleaned up on the next mount. OPFS entries otherwise survive for ever, and a
 *  few abandoned 4K clips would sit in the origin's quota indefinitely. */
const VAULT_INDEX_KEY = "clipper:newreq:vault";

/** Refuse to vault a file unless the origin has this multiple of its size free.
 *  A copy that fills the quota would fail partway and take the rest of the batch
 *  down with it, so leave slack rather than discovering the limit mid-write.
 *
 *  A refusal here is not the end for that file: the form retries the copy just
 *  before that file's own upload, by which point earlier copies have been
 *  released and the room usually exists. */
const QUOTA_HEADROOM = 1.15;

/** Keys written by THIS page instance. The mount sweep uses it to tell an
 *  abandoned entry from one that is in active use — without it a sweep racing a
 *  fresh selection could delete a file that is about to be uploaded. */
const liveKeys = new Set<string>();

/** What a caller needs to read a vaulted copy back. `name`/`type` are carried
 *  because OPFS stores neither: the stored file's own name is the opaque key. */
export interface VaultEntry {
  key: string;
  name: string;
  type: string;
  size: number;
}

/**
 * Does this read failure mean the file's bytes are no longer reachable?
 *
 * `NotReadableError` is the stale-reference case described above.
 * `NotFoundError` is its sibling: the file was moved or deleted after being
 * picked. Neither is retryable — there is nothing to retry against — so callers
 * must stop and ask for the file to be re-selected rather than looping.
 *
 * Matched three ways because the shape varies by engine and by how far the
 * error has been re-wrapped by the time it is classified: a real `DOMException`
 * where one survives, a duck-typed `name`, and finally the message text, which
 * is what is left after an error crosses a `postMessage`/serialisation boundary.
 */
export function isUnreadableFileError(err: unknown): boolean {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotReadableError" || name === "NotFoundError") return true;

  const message = err instanceof Error ? err.message : String(err ?? "");
  return /NotReadableError|NotFoundError|could not be read|permission problems that have occurred/i.test(
    message
  );
}

/** OPFS present? Feature-detected on `getDirectory` alone; everything past that
 *  point is wrapped in try/catch so a partial implementation degrades to the
 *  fallback path instead of throwing at import time. */
export function isFileVaultSupported(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function"
    );
  } catch {
    return false;
  }
}

async function vaultDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(VAULT_DIR, { create: true });
}

function readIndex(): string[] {
  try {
    const parsed: unknown = JSON.parse(lsGet(VAULT_INDEX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]): void {
  if (keys.length === 0) lsRemove(VAULT_INDEX_KEY);
  else lsSet(VAULT_INDEX_KEY, JSON.stringify(keys));
}

/**
 * Bytes this origin could still write, or null where the browser will not say.
 *
 * Exported because the storage cost is the vault's real trade-off: it needs room
 * for a private copy of the whole selection, and on a phone that has not got it
 * the vault refuses and uploads fall back to the fragile picker reference. That
 * degradation has to be visible to the user at selection time, while they can
 * still act on it, so the form checks this before copying anything.
 *
 * Chromium derives the quota from free disk space, so this tracks the device
 * filling up — but it is an estimate, not an allocation. A copy can still fail
 * partway; vaultPut cleans up and falls back when it does.
 */
export async function estimateFreeBytes(): Promise<number | null> {
  try {
    const est = await navigator.storage.estimate();
    if (typeof est.quota === "number" && typeof est.usage === "number") {
      return Math.max(0, est.quota - est.usage);
    }
  } catch {
    /* not available */
  }
  return null;
}

/** Reject a copy that the origin plainly cannot hold. When the estimate is
 *  unavailable we proceed and let the write fail naturally — a missing estimate
 *  is not evidence of a full disk. */
async function ensureRoom(bytes: number): Promise<void> {
  const free = await estimateFreeBytes();
  if (free !== null && free < bytes * QUOTA_HEADROOM) {
    const needMb = Math.ceil((bytes * QUOTA_HEADROOM) / (1024 * 1024));
    const freeMb = Math.floor(free / (1024 * 1024));
    throw new Error(`file vault: not enough origin storage (need ~${needMb}MB, ${freeMb}MB free)`);
  }
}

/**
 * Stream one picked file into the vault.
 *
 * This is the ONLY place the original `File` is read in full, and it happens
 * moments after the picker returns — the point at which the content:// grant is
 * most likely to still be valid. A `NotReadableError` raised here means the file
 * was never readable (a cloud/SD placeholder that is not on the device), which
 * is worth surfacing immediately: it is the one unreadable case the user can fix
 * before waiting through an upload.
 *
 * The size is verified after the copy. A short write would otherwise produce a
 * truncated upload that only fails at the server's ffprobe, long after the bytes
 * were sent.
 */
export async function vaultPut(
  key: string,
  file: File,
  onProgress?: (copied: number, total: number) => void
): Promise<VaultEntry> {
  if (!isFileVaultSupported()) throw new Error("file vault: OPFS unavailable");
  await ensureRoom(file.size);

  liveKeys.add(key);
  const index = readIndex();
  if (!index.includes(key)) writeIndex([...index, key]);

  const dir = await vaultDir();
  const handle = await dir.getFileHandle(key, { create: true });
  const writable = await handle.createWritable();

  try {
    const reader = file.stream().getReader();
    let copied = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await writable.write(value);
      copied += value.byteLength;
      onProgress?.(copied, file.size);
    }
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      /* the stream is already unusable — nothing to unwind */
    }
    await vaultDelete(key);
    throw err;
  }

  const stored = await handle.getFile();
  if (stored.size !== file.size) {
    await vaultDelete(key);
    throw new Error(
      `file vault: short copy of ${file.name} (${stored.size}B of ${file.size}B)`
    );
  }

  return { key, name: file.name, type: file.type, size: file.size };
}

/**
 * Read a vaulted copy back as a `File` carrying the original name and MIME type.
 *
 * `new File([stored], …)` re-wraps the OPFS blob by reference — it does not copy
 * the bytes — so this stays cheap for a 100 MB clip and slicing it still reads
 * only the requested range.
 */
export async function vaultFile(entry: VaultEntry): Promise<File> {
  const dir = await vaultDir();
  const handle = await dir.getFileHandle(entry.key);
  const stored = await handle.getFile();
  return new File([stored], entry.name, { type: entry.type });
}

/** Drop one vaulted copy. Safe to call for a key that was never written. */
export async function vaultDelete(key: string): Promise<void> {
  liveKeys.delete(key);
  writeIndex(readIndex().filter((k) => k !== key));
  try {
    const dir = await vaultDir();
    await dir.removeEntry(key);
  } catch {
    /* never written, or already gone */
  }
}

/**
 * Remove every vaulted copy this page instance is not using.
 *
 * Called on mount. A reload cannot reuse a vault entry — the `PendingFile` list
 * that referenced it is gone and `File` objects do not survive a navigation — so
 * anything the index still names is by definition abandoned, and would otherwise
 * hold hundreds of megabytes of the origin's quota for ever.
 */
export async function vaultSweep(): Promise<void> {
  const stale = readIndex().filter((k) => !liveKeys.has(k));
  if (stale.length === 0) return;

  let dir: FileSystemDirectoryHandle;
  try {
    dir = await vaultDir();
  } catch {
    return;
  }
  for (const key of stale) {
    try {
      await dir.removeEntry(key);
    } catch {
      /* already gone */
    }
  }
  writeIndex(readIndex().filter((k) => liveKeys.has(k)));
}
