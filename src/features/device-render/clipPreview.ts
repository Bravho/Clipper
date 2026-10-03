"use client";

import { makePreviewProxyOnDevice } from "@/lib/mobile/deviceVideoRender";
import { probeVideo } from "./editorState";
import { studioEnglish, type StudioT } from "./studioText";

/**
 * Get a clip ready for the studio: its length, a poster frame, and something
 * the WebView can actually play in the storyboard and the trimmer.
 *
 * WHY A FALLBACK. A phone camera's MP4 is often HEVC (H.265), 10-bit HDR, or
 * 4K at 60 fps. The phone's own video engine — which makes the final video —
 * decodes those, but the in-app browser frequently cannot, and then the clip
 * has no length, no thumbnail and a black preview. So when the browser fails,
 * this asks the app to make a light 720p H.264 PREVIEW COPY on the phone
 * (Media3 / AVFoundation) and uses that for the screen. The original is still
 * what is kept, submitted and rendered; the copy only ever feeds the preview.
 */
export interface PreparedClip {
  durationSeconds: number;
  posterUrl: string | null;
  /** Object URL the storyboard and trimmer play. */
  previewUrl: string;
  /** Set when a preview copy had to be made, to tell the person why. */
  note: string | null;
}

export class ClipUnreadableError extends Error {}

export async function prepareClip(
  file: File,
  t: StudioT = studioEnglish,
  /** Told when the slow path starts: the phone is making a preview copy. */
  onProxy?: () => void
): Promise<PreparedClip> {
  try {
    const probed = await probeVideo(file);
    return {
      durationSeconds: probed.durationSeconds,
      posterUrl: probed.posterUrl,
      previewUrl: URL.createObjectURL(file),
      note: null,
    };
  } catch {
    // The browser cannot read this one; try the app's own video engine.
  }

  let proxy: File | null = null;
  onProxy?.();
  try {
    proxy = await makePreviewProxyOnDevice(file);
  } catch {
    proxy = null;
  }
  if (proxy) {
    try {
      const probed = await probeVideo(proxy);
      return {
        durationSeconds: probed.durationSeconds,
        posterUrl: probed.posterUrl,
        previewUrl: URL.createObjectURL(proxy),
        note: t("studio.pipe.proxyNote", { name: file.name }),
      };
    } catch {
      // Fall through to the plain explanation.
    }
  }

  throw new ClipUnreadableError(t("studio.pipe.clipUnreadable", { name: file.name }));
}
