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
 *  1. Download the bytes with `CapacitorHttp`, which runs on the OS network
 *     stack (not the WebView), bypassing CORS. On native, a `blob` response is
 *     returned as base64 — exactly what Filesystem wants.
 *  2. Write the file into the app's Cache directory (no runtime storage
 *     permission needed on Android or iOS).
 *  3. Open the OS share/save sheet on the REAL local file so the user can store
 *     it where they want — Photos ("Save Video"), Files, or Downloads.
 *
 * @throws if the download or file write fails (caller surfaces the message).
 */
export async function saveVideoToDevice(url: string, fileName: string): Promise<void> {
  const safeName = sanitizeFileName(fileName);

  // 1. Native HTTP GET — not subject to WebView CORS. `blob` → base64 on native.
  const resp = await CapacitorHttp.get({ url, responseType: "blob" });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`ดาวน์โหลดไม่สำเร็จ (${resp.status})`);
  }
  const base64 = typeof resp.data === "string" ? resp.data : "";
  if (!base64) throw new Error("ไฟล์ที่ดาวน์โหลดว่างเปล่า");

  // 2. Persist to the app cache (recursive so a nested name still works).
  const written = await Filesystem.writeFile({
    path: safeName,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  // 3. Hand the real file to the OS so the user can save it to Photos / Files.
  await Share.share({
    title: safeName,
    url: written.uri,
    dialogTitle: "บันทึกวิดีโอ",
  });
}

/** Strip anything that could break out of a single flat file name. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/]+/g, "").trim().slice(0, 200);
  return cleaned || "rclipper-video.mp4";
}
