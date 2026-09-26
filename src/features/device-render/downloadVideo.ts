"use client";

import { Share } from "@capacitor/share";

import { isNativeMobile } from "@/lib/mobile/platform";
import { saveVideoToDevice } from "@/lib/mobile/nativeDownload";
import { finishedVideoUri, shareableCopy } from "@/lib/mobile/finishedVideoCache";

/**
 * Download one finished video of a request — the same route and the same
 * native/web split the request page's distribution panel uses, so the server's
 * ownership and download checks apply here unchanged.
 *
 * On the phone: when this phone made the video it still has it
 * (`finishedVideoCache`), and it goes straight to the Save/Share sheet — the
 * server is only asked for the file's name and whether it may be downloaded.
 * Otherwise the file is fetched by the OS (not the WebView, which CORS would
 * block) and handed to the sheet. In a browser it is a same-origin attachment.
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
}): Promise<void> {
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
    const uri = (await shareableCopy(input.assetId, fileName)) ?? kept;
    input.onProgress?.(1);
    await Share.share({ title: fileName, url: uri, dialogTitle: fileName });
    return;
  }
  if (nativeApp) {
    await saveVideoToDevice(body.url as string, fileName, input.onProgress);
    return;
  }
  const link = document.createElement("a");
  link.href = body.downloadUrl as string;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/:*?<>|]+/g, "").trim().slice(0, 150);
  return cleaned || "rclipper-video.mp4";
}
