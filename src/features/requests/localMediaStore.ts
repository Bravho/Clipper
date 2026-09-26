import type { FileSnapshot } from "./fileSnapshot";
import { snapshotFile, snapshotsSupported } from "./fileSnapshot";
import {
  localMediaDescriptorSchema,
  type LocalAnalysisFrame,
  type LocalMediaDescriptor,
} from "@/lib/mobile/localMediaContract";

const LOCAL_MEDIA_DIR = "rclipper-local-materials";
const COPY_CHUNK_BYTES = 8 * 1024 * 1024;

async function materialDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(LOCAL_MEDIA_DIR, { create: true });
}

function safeLocalId(requestId: string, itemId: string): string {
  return `${requestId}--${itemId}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * The index that makes a retained original findable again later.
 *
 * WHY IT EXISTS. A device render is claimed from the request page, which the
 * requester may open days after picking their media and in a fresh WebView with
 * no React state left. The render manifest names each device-held source by
 * `localId` alone, so without a persisted descriptor the phone would hold the
 * bytes and still not know which file to open. OPFS gives us durable storage
 * but no metadata, so we keep our own small sidecar next to the originals.
 *
 * It is a cache, not a source of truth: a missing or corrupt index costs a
 * fallback (`descriptorForLocalId` reconstructs what it can from the stored
 * file), never a lost render.
 */
const INDEX_FILE = "index.json";

/**
 * Index writes are serialised through this chain. `retainLocalMaterial` is
 * called once per picked file and the picker hands us all of them at once, so
 * concurrent read-modify-write of one JSON file is the normal case, not the
 * exotic one — without the chain the last writer would erase its siblings.
 */
let indexWrites: Promise<unknown> = Promise.resolve();

async function readIndexRecord(): Promise<Record<string, LocalMediaDescriptor>> {
  try {
    const dir = await materialDir();
    const handle = await dir.getFileHandle(INDEX_FILE);
    const parsed: unknown = JSON.parse(await (await handle.getFile()).text());
    if (!parsed || typeof parsed !== "object") return {};
    const entries: Record<string, LocalMediaDescriptor> = {};
    for (const [localId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const descriptor = localMediaDescriptorSchema.safeParse(value);
      if (descriptor.success) entries[localId] = descriptor.data;
    }
    return entries;
  } catch {
    return {};
  }
}

function mutateIndex(
  change: (entries: Record<string, LocalMediaDescriptor>) => void
): Promise<void> {
  const next = indexWrites.then(async () => {
    const entries = await readIndexRecord();
    change(entries);
    const dir = await materialDir();
    const handle = await dir.getFileHandle(INDEX_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(entries));
    await writable.close();
  });
  // Keep the chain alive after a failure, and never surface an index error as a
  // failed retain: the bytes are already safely stored by the time we get here.
  indexWrites = next.catch(() => undefined);
  return indexWrites as Promise<void>;
}

/**
 * Every original this device is still holding, by `localId`.
 *
 * This is what a render needs: the manifest names sources by `localId`, and
 * `stageManifestSources` resolves each one through this map.
 */
export async function loadLocalMediaIndex(): Promise<Map<string, LocalMediaDescriptor>> {
  if (!snapshotsSupported()) return new Map();
  return new Map(Object.entries(await readIndexRecord()));
}

/**
 * One descriptor, with a reconstruction fallback.
 *
 * If the index lost an entry but the file is still there, we can still render:
 * the renderer only needs the bytes and a container hint, and both survive in
 * OPFS. Returning null means the original is genuinely gone.
 */
export async function descriptorForLocalId(
  localId: string
): Promise<LocalMediaDescriptor | null> {
  if (!snapshotsSupported()) return null;
  const indexed = (await readIndexRecord())[localId];
  if (indexed) return indexed;
  try {
    const dir = await materialDir();
    const file = await (await dir.getFileHandle(localId)).getFile();
    return localMediaDescriptorSchema.parse({
      localId,
      fileName: localId,
      mimeType: file.type || "application/octet-stream",
      fileSizeBytes: file.size,
      durationSeconds: null,
    });
  } catch {
    return null;
  }
}

/**
 * Promote a short-lived picker snapshot into durable, device-private storage.
 * The returned descriptor is safe to persist on the server; it contains no URI
 * or media bytes and only this app origin can resolve localId.
 */
export async function retainLocalMaterial(
  requestId: string,
  itemId: string,
  snapshot: FileSnapshot,
  durationSeconds: number | null = null
): Promise<LocalMediaDescriptor> {
  if (!snapshotsSupported()) {
    throw new Error("Device-private media storage is unavailable.");
  }
  return writeRetained(requestId, itemId, await snapshotFile(snapshot), {
    fileName: snapshot.name,
    mimeType: snapshot.type,
    durationSeconds,
  });
}

/**
 * Retain a picked `File` directly, for callers that never made a snapshot.
 *
 * The phone studio holds its picked files in memory while the person edits, so
 * by the time they submit there is no picker snapshot to promote — only the
 * `File` itself. The bytes, the `localId` scheme and the index entry are
 * exactly those `retainLocalMaterial` produces, so a render claimed later from
 * either path finds its originals the same way.
 */
export async function retainLocalFile(
  requestId: string,
  itemId: string,
  file: File,
  durationSeconds: number | null = null
): Promise<LocalMediaDescriptor> {
  if (!snapshotsSupported()) {
    throw new Error("Device-private media storage is unavailable.");
  }
  return writeRetained(requestId, itemId, file, {
    fileName: file.name,
    mimeType: file.type,
    durationSeconds,
  });
}

async function writeRetained(
  requestId: string,
  itemId: string,
  source: File,
  meta: { fileName: string; mimeType: string; durationSeconds: number | null }
): Promise<LocalMediaDescriptor> {
  return writeRetainedAs(safeLocalId(requestId, itemId), source, meta);
}

/**
 * Put an original back under the `localId` the server already knows it by.
 *
 * WHY. The app's private storage is not guaranteed to last: reinstalling the
 * app, clearing its data, or Android reclaiming space under storage pressure
 * empties it, and then a request can no longer be rendered on this phone
 * ("This phone no longer has the original for …"). The server keeps only the
 * descriptors, so the way back is for the person to pick the same files from
 * the gallery again; each is stored under its old `localId` and every later
 * render finds it as if nothing had happened.
 */
export async function restoreLocalMaterial(
  descriptor: LocalMediaDescriptor,
  source: File
): Promise<LocalMediaDescriptor> {
  if (!snapshotsSupported()) {
    throw new Error("Device-private media storage is unavailable.");
  }
  return writeRetainedAs(descriptor.localId, source, {
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    durationSeconds: descriptor.durationSeconds,
  });
}

async function writeRetainedAs(
  localId: string,
  source: File,
  meta: { fileName: string; mimeType: string; durationSeconds: number | null }
): Promise<LocalMediaDescriptor> {
  // Ask the WebView to exempt these user-owned originals from routine storage
  // pressure eviction. The request is advisory on both platforms.
  await navigator.storage.persist?.().catch(() => false);
  const dir = await materialDir();
  const handle = await dir.getFileHandle(localId, { create: true });
  const writable = await handle.createWritable();
  try {
    for (let offset = 0; offset < source.size; offset += COPY_CHUNK_BYTES) {
      await writable.write(source.slice(offset, Math.min(source.size, offset + COPY_CHUNK_BYTES)));
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await dir.removeEntry(localId).catch(() => undefined);
    throw error;
  }
  const descriptor = localMediaDescriptorSchema.parse({
    localId,
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    fileSizeBytes: source.size,
    durationSeconds: meta.durationSeconds,
  });
  // Recorded so a later visit to the request page can still find this file.
  await mutateIndex((entries) => {
    entries[localId] = descriptor;
  });
  return descriptor;
}

export async function readLocalMaterial(
  descriptor: LocalMediaDescriptor
): Promise<File> {
  const dir = await materialDir();
  const handle = await dir.getFileHandle(descriptor.localId);
  const stored = await handle.getFile();
  return new File([stored], descriptor.fileName, { type: descriptor.mimeType });
}

async function imageAnalysisData(source: Blob): Promise<{ mimeType: "image/jpeg"; dataBase64: string }> {
  const bitmap = await createImageBitmap(source);
  try {
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/jpeg", 0.72);
    const prefix = "data:image/jpeg;base64,";
    if (!encoded.startsWith(prefix)) throw new Error("Could not encode analysis image.");
    return { mimeType: "image/jpeg", dataBase64: encoded.slice(prefix.length) };
  } finally {
    bitmap.close();
  }
}

/** Build a compact Gemini input. Originals are never returned from this function. */
export async function createLocalAnalysisFrame(
  descriptor: LocalMediaDescriptor,
  assetIndex: number,
  posterDataUrl?: string
): Promise<LocalAnalysisFrame | null> {
  if (descriptor.mimeType.startsWith("video/")) {
    if (!posterDataUrl?.startsWith("data:image/")) return null;
    const poster = await fetch(posterDataUrl).then((response) => response.blob());
    const encoded = await imageAnalysisData(poster);
    return { localId: descriptor.localId, assetIndex, ...encoded };
  }
  const encoded = await imageAnalysisData(await readLocalMaterial(descriptor));
  return { localId: descriptor.localId, assetIndex, ...encoded };
}

export async function deleteLocalMaterial(localId: string): Promise<void> {
  if (!snapshotsSupported()) return;
  const dir = await materialDir();
  await dir.removeEntry(localId).catch(() => undefined);
  await mutateIndex((entries) => {
    delete entries[localId];
  });
}
