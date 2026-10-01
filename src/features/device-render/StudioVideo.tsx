"use client";

import { Capacitor } from "@capacitor/core";
import { useEffect, useState, type CSSProperties } from "react";

import { finishedVideoUri } from "@/lib/mobile/finishedVideoCache";

/**
 * A finished video's player, playing the copy ON THIS PHONE when there is one.
 *
 * WHY (Tho, 1 Oct). A video this phone made is kept in the app
 * (`finishedVideoCache`, Data/rclipper-finished-videos/<assetId>.mp4), but the
 * players streamed it back from the server through the request's stream route
 * — every seek a ranged request through the droplet to Spaces, which is the
 * "loading while playing" people saw. When the phone has the file, the player
 * now reads it through the WebView's own file server (`convertFileSrc`), which
 * answers range requests from local storage: no network, no buffering.
 *
 * Otherwise (a video made on another phone, or a kept copy already cleaned
 * up) it streams as before, and preloads the whole file rather than only its
 * metadata so playback does not stall once started.
 */
export function StudioVideo({
  assetId,
  url,
  className = "studio-player",
  style,
}: {
  assetId: string | null | undefined;
  url: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [localSrc, setLocalSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLocalSrc(null);
    if (!assetId || !Capacitor.isNativePlatform()) return;
    void finishedVideoUri(assetId)
      .then((uri) => {
        if (!cancelled && uri) setLocalSrc(Capacitor.convertFileSrc(uri));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const src = localSrc ?? url;
  return (
    <video
      key={src}
      src={src}
      controls
      playsInline
      preload={localSrc ? "metadata" : "auto"}
      className={className}
      style={style}
      // A kept copy that cannot be read (cleaned up mid-session) falls back to
      // the server's stream rather than leaving a dead player.
      onError={() => {
        if (localSrc) setLocalSrc(null);
      }}
    />
  );
}
