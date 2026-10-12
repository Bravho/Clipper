"use client";

import type { EditorShot, EditorSource } from "./editorState";

export { shotFramesKey } from "./editorState";

/**
 * Small frames from inside a shot, for the AI to frame each channel shape by.
 *
 * A photo gives one frame. A clip gives up to three, spread across the part of
 * it the shot actually plays (its trimmed window), so a product that moves, or
 * only arrives halfway through, is seen where it really is — not where it was
 * in the clip's first quarter-second, which is all the poster frame shows.
 *
 * Frames are tiny JPEG data URLs (the long side is `FRAME_LONG_SIDE`): enough
 * to find a dish in, and small enough that a whole storyboard fits in a couple
 * of requests. The middle frame doubles as the shot's thumbnail in Channels.
 */

export const FRAME_LONG_SIDE = 320;
const JPEG_QUALITY = 0.7;
const SEEK_TIMEOUT_MS = 5_000;

export interface ShotFrames {
  frames: string[];
  /** The frame to show for this shot (the middle one). */
  thumbnail: string | null;
}

function drawToDataUrl(
  element: CanvasImageSource,
  width: number,
  height: number
): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(1, FRAME_LONG_SIDE / Math.max(width, height));
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return null;
  }
}

function imageFrame(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(drawToDataUrl(image, image.naturalWidth, image.naturalHeight));
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Frames of a clip at the given times; any that will not seek are skipped. */
async function clipFrames(url: string, times: number[]): Promise<string[]> {
  const video = window.document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  const frames: string[] = [];
  const waitFor = (event: "loadeddata" | "seeked") =>
    new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
      const finish = (ok: boolean) => {
        window.clearTimeout(timer);
        video.removeEventListener(event, onEvent);
        video.removeEventListener("error", onError);
        resolve(ok);
      };
      const onEvent = () => finish(true);
      const onError = () => finish(false);
      video.addEventListener(event, onEvent);
      video.addEventListener("error", onError);
    });
  try {
    const loaded = waitFor("loadeddata");
    video.src = url;
    if (!(await loaded)) return frames;
    for (const time of times) {
      const seeked = waitFor("seeked");
      video.currentTime = Math.max(0, time);
      if (!(await seeked)) continue;
      const frame = drawToDataUrl(video, video.videoWidth, video.videoHeight);
      if (frame) frames.push(frame);
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  return frames;
}

/** Never throws: a shot whose frames cannot be taken answers no frames. */
export async function captureShotFrames(
  source: EditorSource,
  shot: EditorShot
): Promise<ShotFrames> {
  try {
    if (source.kind === "image") {
      const frame = (await imageFrame(source.previewUrl)) ??
        (source.posterUrl ? await imageFrame(source.posterUrl) : null);
      return { frames: frame ? [frame] : [], thumbnail: frame };
    }
    const start = Math.max(0, shot.trimStartSeconds);
    const end =
      shot.trimEndSeconds != null && shot.trimEndSeconds > start
        ? shot.trimEndSeconds
        : source.durationSeconds != null && source.durationSeconds > start
          ? source.durationSeconds
          : start + Math.max(0.5, shot.durationSeconds);
    const length = end - start;
    const times =
      length < 1.5
        ? [start + length / 2]
        : [start + length * 0.15, start + length * 0.5, start + length * 0.85];
    const frames = await clipFrames(source.previewUrl, times);
    if (frames.length > 0) {
      return { frames, thumbnail: frames[Math.floor(frames.length / 2)] ?? frames[0] };
    }
    // The WebView could not seek this clip: the poster frame is better than nothing.
    const poster = source.posterUrl ? await imageFrame(source.posterUrl) : null;
    return { frames: poster ? [poster] : [], thumbnail: poster };
  } catch {
    return { frames: [], thumbnail: null };
  }
}
