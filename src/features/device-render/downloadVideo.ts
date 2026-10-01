"use client";

import { Share } from "@capacitor/share";

import { isNativeMobile } from "@/lib/mobile/platform";
import { downloadVideoToAppCache, removeAppCacheCopy } from "@/lib/mobile/nativeDownload";
import { finishedVideoUri, shareableCopy } from "@/lib/mobile/finishedVideoCache";
import { saveVideoToPhoneGallery, type GallerySaveResult } from "@/lib/mobile/deviceRenderBridge";

/** What a download did, so the button can say where the video went. */
export interface StudioDownloadResult {
  /** Saved straight into the phone's gallery (app builds from 1 Oct 2026). */
  gallery: GallerySaveResult | null;
  /** Handed to the share sheet instead (an older app build). */
  shared: boolean;
  /** A browser download (the browser decides the folder). */
  browser: boolean;
}

/**
 * Download one finished video of a request — the same route and the same
 * native/web split the request page's distribution panel uses, so the server's
 * ownership and download checks apply here unchanged.
 *
 * On the phone (Tho, 1 Oct): a REAL download. The video is saved straight into
 * the phone's gallery — Photos on iOS, Movies/RClipper on Android — and the
 * button then says where. When this phone made the video it still has it
 * (`finishedVideoCache`), so the save is instant; otherwise the file is first
 * fetched by the OS into the app's cache (with progress) and then saved.
 * An app build from before the gallery save existed falls back to the share
 * sheet, as before. In a browser it is a same-origin attachment.
 */
export async function downloadStudioVideo(input: {
  requestId: string;
  assetId: string;
  /** Names the file, e.g. "Café - TikTok, Reels.mp4". */
  channel?: string;
  /** The sentence shown when the server gives no reason, in the screen's language. */
  failedMessage?: string;
  /** Share downloaded so far, 0..1 (phone only, when the size is known). */
  onProgress?: (fraction: number) => void;
  /** Which part is running: fetching the file, or writing it into the gallery. */
  onStage?: (stage: "downloading" | "saving") => void;
}): Promise<StudioDownloadResult> {
  const params = new URLSearchParams({ assetId: input.assetId });
  if (input.channel) params.set("channel", input.channel);
  const nativeApp = isNativeMobile();
  const kept = nativeApp ? await finishedVideoUri(input.assetId) : null;

  let response: Response | null = null;
  try {
    response = await fetch(`/api/requests/${input.requestId}/download?${params.toString()}`, {
      cache: "no-store",
    });
  } catch (error) {
    // No connection: a video this phone made can still be saved.
    if (!kept) throw error;
  }
  const body = (response ? await response.json().catch(() => ({})) : {}) as {
    url?: string;
    downloadUrl?: string;
    fileName?: string;
    error?: string;
  };
  // The server's checks (ownership, a locked download) apply to the phone's
  // own copy too: it is only offered when the server would offer the file.
  if (response && (!response.ok || !body.url || !body.downloadUrl)) {
    throw new Error(body.error ?? input.failedMessage ?? "The video could not be downloaded.");
  }
  const fileName = sanitize(
    body.fileName ?? (input.channel ? `RClipper - ${input.channel}.mp4` : "rclipper-video.mp4")
  );

  if (kept) {
    // Made on this phone: no download at all, straight into the gallery.
    input.onStage?.("saving");
    input.onProgress?.(1);
    const gallery = await saveVideoToPhoneGallery(kept, fileName);
    if (gallery) return { gallery, shared: false, browser: false };
    const uri = (await shareableCopy(input.assetId, fileName)) ?? kept;
    await Share.share({ title: fileName, url: uri, dialogTitle: fileName });
    return { gallery: null, shared: true, browser: false };
  }

  if (nativeApp) {
    input.onStage?.("downloading");
    const cached = await downloadVideoToAppCache(body.url as string, fileName, input.onProgress);
    input.onStage?.("saving");
    let gallery: GallerySaveResult | null = null;
    try {
      gallery = await saveVideoToPhoneGallery(cached, fileName);
    } finally {
      // The gallery holds its own copy now; an older build shares it below.
      if (gallery) await removeAppCacheCopy(fileName);
    }
    if (gallery) return { gallery, shared: false, browser: false };
    // Older app build: the share sheet, from the file already downloaded.
    await Share.share({ title: fileName, url: cached, dialogTitle: fileName });
    return { gallery: null, shared: true, browser: false };
  }

  const link = document.createElement("a");
  link.href = body.downloadUrl as string;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { gallery: null, shared: false, browser: true };
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/:*?<>|]+/g, "").trim().slice(0, 150);
  return cleaned || "rclipper-video.mp4";
}
