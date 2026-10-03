/**
 * Client-side persistence for an in-progress "new request" draft.
 *
 * Two things survive a reload / the app being backgrounded on iOS/Android:
 *   • the draft request's id, so returning continues that request instead of
 *     minting a new one and orphaning the files already uploaded to it;
 *   • per-file multipart session ids, so a partly-uploaded video resumes via
 *     ListParts instead of restarting.
 *
 * The legacy upload flow retains multipart ids here. The optional native
 * local-first flow stores originals in OPFS through localMediaStore instead.
 *
 * This lives in its own module because the delete buttons need to clear it too.
 * They previously could not — the helpers were private to NewRequestForm — so
 * deleting a draft from the dashboard left this pointer behind, and the next
 * visit to "new request" tried to resume a request that no longer existed.
 */

/** localStorage helpers — never throw (some WebView configs restrict storage). */
export function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Persisted id of the in-progress draft. */
export const DRAFT_ID_KEY = "clipper:newreq:draftId";

/** A resumable multipart session for one file. No bytes — only the ids needed to
 *  resume via ListParts once the same file is re-selected. */
export interface MpuSession {
  assetId: string;
  key: string;
  uploadId: string;
  /**
   * Spaces has assembled all parts into the tmp object, but the application has
   * not yet received a successful /confirm response. Keeping this phase lets a
   * retry repeat only confirmation instead of restarting a 100%-uploaded file.
   */
  completed?: boolean;
  /** The part size the ALREADY-UPLOADED parts were sliced at, echoed by the
   *  server on initiate and persisted here. Resuming must re-slice at exactly
   *  the same boundaries — computing them from a shared constant instead meant
   *  that changing the part size on either side would silently splice a
   *  half-old, half-new object together. Optional so sessions persisted by an
   *  older build still load. */
  partSize?: number;
}

export const mpuMapKey = (draftId: string) => `clipper:newreq:mpu:${draftId}`;

export function loadMpuMap(draftId: string): Record<string, MpuSession> {
  try {
    return JSON.parse(lsGet(mpuMapKey(draftId)) || "{}") as Record<string, MpuSession>;
  } catch {
    return {};
  }
}

export function getMpuSession(draftId: string, sig: string): MpuSession | null {
  return loadMpuMap(draftId)[sig] ?? null;
}

export function saveMpuSession(draftId: string, sig: string, s: MpuSession): void {
  const m = loadMpuMap(draftId);
  m[sig] = s;
  lsSet(mpuMapKey(draftId), JSON.stringify(m));
}

export function clearMpuSession(draftId: string, sig: string): void {
  const m = loadMpuMap(draftId);
  delete m[sig];
  lsSet(mpuMapKey(draftId), JSON.stringify(m));
}

/** Forget everything about a draft: the global pointer and its session map. */
export function clearDraftPersistence(draftId: string | null): void {
  lsRemove(DRAFT_ID_KEY);
  if (draftId) lsRemove(mpuMapKey(draftId));
}

/**
 * Clear persistence for a draft that was just deleted server-side, WITHOUT
 * disturbing an unrelated draft the user may be working on.
 *
 * Deleting draft A from the dashboard must not wipe the pointer to draft B.
 * So the global pointer is only dropped when it actually names this draft; the
 * session map is keyed per draft and is always safe to remove.
 */
export function forgetDeletedDraft(draftId: string): void {
  if (lsGet(DRAFT_ID_KEY) === draftId) {
    lsRemove(DRAFT_ID_KEY);
  }
  lsRemove(mpuMapKey(draftId));
}
