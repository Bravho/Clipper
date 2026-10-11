"use client";

/**
 * Picked media that survives the app closing BEFORE Submit.
 *
 * WHY (2026-10-11). Until a request is submitted, the studio held its picked
 * photos and clips only in memory. Each one already had a private copy in the
 * app's storage (`takePrivateCopy`, key `studio-<id>`), but nothing recorded
 * which copies belonged to which request — so an app that closed (a crash, the
 * phone reclaiming memory, the person swiping it away) reopened on an empty
 * Media step, and the upload-snapshot sweep deleted the orphaned copies six
 * hours later. The person had to pick everything again.
 *
 * Now the studio writes a small list per request (name, kind, length and the
 * private copy's key) whenever its sources change, and reads it back when it
 * reopens on an unsubmitted request. The copies under `studio-` are kept for
 * ORIGINALS_KEPT_DAYS (fileSnapshot.ts), the same as submitted originals.
 * After Submit the originals live in the durable material store and this list
 * is dropped.
 *
 * Stored in localStorage (a few hundred bytes per request); every access is
 * guarded, and losing it only means the old behaviour.
 */
import { ORIGINALS_KEPT_DAYS } from "@/config/localMedia";
import { snapshotFile } from "@/features/requests/fileSnapshot";
import { prepareClip } from "./clipPreview";
import { readImagePoster, type EditorSource } from "./editorState";

const PREFIX = "rclipper-studio-draft-media:";

interface DraftEntry {
  id: string;
  kind: "image" | "clip";
  fileName: string;
  type: string;
  size: number;
  durationSeconds: number | null;
  snapshotKey: string;
}

interface DraftRecord {
  savedAt: number;
  entries: DraftEntry[];
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Remember which private copies make up this request's picked media. */
export function saveDraftSources(requestId: string, sources: readonly EditorSource[]): void {
  const store = storage();
  if (!store) return;
  const entries: DraftEntry[] = sources
    .filter((source) => Boolean(source.snapshotKey))
    .map((source) => ({
      id: source.id,
      kind: source.kind,
      fileName: source.fileName,
      type: source.file.type,
      size: source.file.size,
      durationSeconds: source.durationSeconds,
      snapshotKey: source.snapshotKey as string,
    }));
  try {
    if (entries.length === 0) store.removeItem(PREFIX + requestId);
    else store.setItem(PREFIX + requestId, JSON.stringify({ savedAt: Date.now(), entries }));
  } catch {
    /* storage full or blocked: the copies still exist, only the list is lost */
  }
}

/** Forget the list (after Submit, or when the request is abandoned). */
export function clearDraftSources(requestId: string): void {
  try {
    storage()?.removeItem(PREFIX + requestId);
  } catch {
    /* nothing to do */
  }
}

/**
 * The picked media of an unsubmitted request, read back from the private
 * copies. Copies that are gone are skipped; a picture that cannot be made is
 * not a reason to drop the file.
 */
export async function loadDraftSources(requestId: string): Promise<EditorSource[]> {
  const store = storage();
  if (!store) return [];
  let record: DraftRecord | null = null;
  try {
    const raw = store.getItem(PREFIX + requestId);
    record = raw ? (JSON.parse(raw) as DraftRecord) : null;
  } catch {
    record = null;
  }
  if (!record || !Array.isArray(record.entries)) return [];
  if (Date.now() - record.savedAt > ORIGINALS_KEPT_DAYS * 86_400_000) {
    clearDraftSources(requestId);
    return [];
  }

  const sources: EditorSource[] = [];
  for (const entry of record.entries) {
    let file: File;
    try {
      file = await snapshotFile({
        key: entry.snapshotKey,
        name: entry.fileName,
        size: entry.size,
        type: entry.type,
      });
    } catch {
      continue; // that copy is gone
    }
    let picture: { durationSeconds: number | null; posterUrl: string | null; previewUrl: string };
    try {
      picture =
        entry.kind === "clip"
          ? await prepareClip(file)
          : {
              durationSeconds: null,
              posterUrl: await readImagePoster(file),
              previewUrl: URL.createObjectURL(file),
            };
    } catch {
      picture = { durationSeconds: null, posterUrl: null, previewUrl: URL.createObjectURL(file) };
    }
    sources.push({
      id: entry.id,
      kind: entry.kind,
      file,
      previewUrl: picture.previewUrl,
      posterUrl: picture.posterUrl,
      durationSeconds: picture.durationSeconds ?? entry.durationSeconds,
      fileName: entry.fileName,
      snapshotKey: entry.snapshotKey,
    });
  }
  return sources;
}

/**
 * Free the private copies no unsubmitted request still lists — the picks of
 * requests that were submitted (their originals now live in the material
 * store) or whose list was dropped. Run once when the studio opens; copies
 * younger than an hour are left alone, in case another tab is mid-pick.
 */
export async function sweepOrphanStudioCopies(): Promise<number> {
  const store = storage();
  if (!store || typeof navigator === "undefined" || !navigator.storage?.getDirectory) return 0;
  const listed = new Set<string>();
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const record = JSON.parse(store.getItem(key) ?? "null") as DraftRecord | null;
      for (const entry of record?.entries ?? []) listed.add(entry.snapshotKey);
    }
  } catch {
    return 0; // cannot tell what is in use: delete nothing
  }
  let removed = 0;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("rclipper-upload-snapshots", { create: true });
    const cutoff = Date.now() - 60 * 60 * 1000;
    const entries = (dir as unknown as { values?: () => AsyncIterable<FileSystemHandle> }).values;
    if (typeof entries !== "function") return 0;
    const doomed: string[] = [];
    for await (const entry of entries.call(dir)) {
      if (entry.kind !== "file" || !entry.name.startsWith("studio-") || listed.has(entry.name)) continue;
      try {
        if ((await (entry as FileSystemFileHandle).getFile()).lastModified < cutoff) doomed.push(entry.name);
      } catch {
        /* unreadable: leave it */
      }
    }
    for (const name of doomed) {
      await dir.removeEntry(name).catch(() => undefined);
      removed += 1;
    }
  } catch {
    /* storage unavailable */
  }
  return removed;
}
