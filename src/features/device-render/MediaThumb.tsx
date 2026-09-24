"use client";

import type { EditorSource } from "./editorState";

/**
 * One piece of material, as a picture.
 *
 * WHY THIS IS NOT A `<video>` TAG. It used to be. A `<video src=blob:…>` in the
 * Android WebView draws the system's grey play-button placeholder until it is
 * played, so a grid of three different clips came out as three identical grey
 * squares — which is precisely the thing a thumbnail exists to prevent. The
 * editor now captures a real frame when the file is added (`probeVideo`) and
 * this shows that frame, exactly as it shows a photo.
 *
 * When the capture failed there is no honest picture to draw, so the file's own
 * name is shown instead. A generic film icon would look like a thumbnail while
 * telling you nothing — the same failure in nicer clothes.
 */
export function MediaThumb({ source }: { source: EditorSource }) {
  if (source.posterUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={source.posterUrl} alt={source.fileName} />;
  }

  return (
    <span className="studio-media-fallback">
      <strong>{source.kind === "clip" ? "Clip" : "Photo"}</strong>
      <span>{source.fileName}</span>
    </span>
  );
}
