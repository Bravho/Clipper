"use client";

import {
  createSnapshot,
  deleteSnapshot,
  snapshotFile,
} from "@/features/requests/fileSnapshot";
import { isUnreadableFileError } from "@/features/requests/uploadDiagnostics";
import { studioEnglish, type StudioT } from "./studioText";

/**
 * Make a picked photo or clip safe to use for the rest of the session.
 *
 * WHY. On Android a picked `File` is only a reference to something the gallery
 * owns, and that reference dies on its own: the picker's permission lapses when
 * the app is backgrounded or rotated, a cloud-only item (Google Photos, LINE,
 * Drive) was never on the phone to begin with, and a decoder failing on the
 * file can drop the handle. Chrome then throws "The requested file could not be
 * read, typically due to permission problems…" — at submit, long after the
 * person picked it, with nothing they can do but start again.
 *
 * So the studio does what the request form already does (`fileSnapshot.ts`):
 * copy the bytes into the app's own private storage the moment the file is
 * picked, and use only that copy afterwards. A file that cannot be read even
 * then is refused on the spot, by name, with the reason.
 */

export class PickedFileError extends Error {}

export function unreadableMessage(fileName: string, t: StudioT = studioEnglish): string {
  return t("studio.pipe.pickedUnreadable", { name: fileName });
}

export interface PrivateCopy {
  file: File;
  /** The private copy's key, to delete it with the source; null when none was made. */
  snapshotKey: string | null;
}

export async function takePrivateCopy(
  key: string,
  file: File,
  t: StudioT = studioEnglish
): Promise<PrivateCopy> {
  try {
    const snapshot = await createSnapshot(key, file);
    if (snapshot) return { file: await snapshotFile(snapshot), snapshotKey: key };
  } catch (error) {
    if (isUnreadableFileError(error)) throw new PickedFileError(unreadableMessage(file.name, t));
    throw error;
  }
  // No private storage on this WebView (or no room): keep the gallery's file,
  // but at least find out now whether it can be read at all.
  try {
    await file.slice(0, 64 * 1024).arrayBuffer();
  } catch (error) {
    if (isUnreadableFileError(error)) throw new PickedFileError(unreadableMessage(file.name, t));
    throw error;
  }
  return { file, snapshotKey: null };
}

export async function dropPrivateCopy(snapshotKey: string | null | undefined): Promise<void> {
  if (snapshotKey) await deleteSnapshot(snapshotKey);
}

/** HEIC/HEIF, whatever the name says: the in-app browser cannot draw these. */
export async function looksLikeHeic(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const brand = String.fromCharCode(...head.slice(4, 12));
    return /^ftyp(heic|heix|hevc|heim|heis|mif1|msf1)/.test(brand);
  } catch {
    return false;
  }
}
