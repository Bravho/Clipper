"use client";

import { CapacitorHttp } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Save a remote file to the device on native (Capacitor) builds.
 *
 * Why not a plain browser download on native:
 *  - The native app is a WebView shell loading the remote site, so a `fetch`
 *    of the presigned Spaces URL is CROSS-ORIGIN and gets blocked by CORS.
 *  - `<a download>` and `window.open` don't reliably write a file to the device
 *    from inside the WebView.
 *
 * So we:
 *  1. Download the file on the OS network stack (not the WebView, so no CORS)
 *     straight into the app's Cache directory with `Filesystem.downloadFile`
 *     — no runtime storage permission, and no bytes through the JS bridge.
 *  2. (Old builds without it: `CapacitorHttp` + `writeFile`, via base64.)
 *  3. Open the OS share/save sheet on the REAL local file so the user can store
 *     it where they want — Photos ("Save Video"), Files, or Downloads.
 *
 * @throws if the download or file write fails (caller surfaces the message).
 */
export async function saveVideoToDevice(
  url: string,
  fileName: string,
  /** Share downloaded so far, 0..1, when the size is known. */
  onProgress?: (fraction: number) => void
): Promise<void> {
  const safeName = sanitizeFileName(fileName);

  // 1+2. Stream the file straight to disk on the OS side. The old path —
  // CapacitorHttp with a `blob` response — carried the WHOLE video across the
  // bridge as one base64 string and then back again to be written, which for
  // a 60 MB video is minutes of "Preparing the file…" or an out-of-memory
  // WebView. `Filesystem.downloadFile` is in every build that has the
  // Filesystem plugin (deprecated in favour of @capacitor/file-transfer, which
  // would need a new app build; it still works in v8).
  let uri: string | null = null;
  try {
    uri = await downloadToCache(url, safeName, onProgress);
  } catch (error) {
    if (!isUnimplemented(error)) throw error;
  }
  if (!uri) uri = await downloadThroughBridge(url, safeName);

  // 3. Hand the real file to the OS so the user can save it to Photos / Files.
  await Share.share({
    title: safeName,
    url: uri,
    dialogTitle: "บันทึกวิดีโอ",
  });
}

async function downloadToCache(
  url: string,
  safeName: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const listener = onProgress
    ? await Filesystem.addListener("progress", (status) => {
        if (status.url === url && status.contentLength > 0) {
          onProgress(Math.min(1, status.bytes / status.contentLength));
        }
      }).catch(() => null)
    : null;
  try {
    await Filesystem.downloadFile({
      url,
      path: safeName,
      directory: Directory.Cache,
      recursive: true,
      progress: Boolean(onProgress),
    });
  } finally {
    await listener?.remove().catch(() => undefined);
  }
  const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache });
  return uri;
}

/** The old way, for a build whose Filesystem plugin has no `downloadFile`. */
async function downloadThroughBridge(url: string, safeName: string): Promise<string> {
  // Native HTTP GET — not subject to WebView CORS. `blob` → base64 on native.
  const resp = await CapacitorHttp.get({ url, responseType: "blob" });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ดาวน์โหลดไม่สำเร็จ (${resp.status})`);
  }
  const base64 = typeof resp.data === "string" ? resp.data : "";
  if (!base64) throw new Error("ไฟล์ที่ดาวน์โหลดว่างเปล่า");

  const written = await Filesystem.writeFile({
    path: safeName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  return written.uri;
}

function isUnimplemented(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "UNIMPLEMENTED" || /not implemented|unimplemented/i.test(message);
}

/** Strip anything that could break out of a single flat file name. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/]+/g, "").trim().slice(0, 200);
  return cleaned || "rclipper-video.mp4";
}
