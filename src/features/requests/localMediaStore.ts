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
  // Ask the WebView to exempt these user-owned originals from routine storage
  // pressure eviction. The request is advisory on both platforms.
  await navigator.storage.persist?.().catch(() => false);
  const source = await snapshotFile(snapshot);
  const localId = safeLocalId(requestId, itemId);
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
  return localMediaDescriptorSchema.parse({
    localId,
    fileName: snapshot.name,
    mimeType: snapshot.type,
    fileSizeBytes: snapshot.size,
    durationSeconds,
  });
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
}
