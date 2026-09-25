"use client";

import { isNativeMobile } from "@/lib/mobile/platform";
import { saveVideoToDevice } from "@/lib/mobile/nativeDownload";

/**
 * Download one finished video of a request — the same route and the same
 * native/web split the request page's distribution panel uses, so the server's
 * ownership and download checks apply here unchanged.
 *
 * On the phone the file is fetched by the OS (not the WebView, which CORS would
 * block) and handed to the share/save sheet; in a browser it is a same-origin
 * attachment.
 */
export async function downloadStudioVideo(input: {
  requestId: string;
  assetId: string;
  /** Names the file, e.g. "Café - TikTok, Reels.mp4". */
  channel?: string;
  /** The sentence shown when the server gives no reason, in the screen's language. */
  failedMessage?: string;
}): Promise<void> {
  const params = new URLSearchParams({ assetId: input.assetId });
  if (input.channel) params.set("channel", input.channel);
  const response = await fetch(`/api/requests/${input.requestId}/download?${params.toString()}`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as {
    url?: string;
    downloadUrl?: string;
    fileName?: string;
    error?: string;
  };
  if (!response.ok || !body.url || !body.downloadUrl) {
    throw new Error(body.error ?? input.failedMessage ?? "The video could not be downloaded.");
  }
  const fileName = body.fileName ?? "rclipper-video.mp4";

  if (isNativeMobile()) {
    await saveVideoToDevice(body.url, fileName);
    return;
  }
  const link = document.createElement("a");
  link.href = body.downloadUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
