"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

/**
 * The voiceover player used on every requester-facing gate that offers the
 * approved narration (script review, scene design, per-scene video review, the
 * merge gate, and the failure-recovery panel).
 *
 * It is a plain native `<audio controls>` — the transport the requester already
 * knows — wrapped in an honest loading state. The native element gives NO signal
 * while it is fetching: the play button simply does nothing for as long as the
 * file takes to arrive over a mobile uplink, which reads as a broken screen.
 * This wrapper reports the real fraction of the file that has arrived, taken
 * from `audio.buffered` against the clip's own duration, and says so in words.
 *
 * `preload="metadata"` is kept, so opening a step still costs only the header —
 * the percentage climbs once playback actually starts pulling the audio.
 */

export interface VoiceAudioPlayerProps {
  src: string;
  /** Shared with the parent so it can pause/reset playback (e.g. before
   *  navigating away, or when regenerating the voice). */
  audioRef?: MutableRefObject<HTMLAudioElement | null>;
  /** Fires once the real length is known — parents use it to size the montage. */
  onDurationKnown?: (seconds: number) => void;
  className?: string;
}

export function VoiceAudioPlayer({
  src,
  audioRef,
  onDurationKnown,
  className,
}: VoiceAudioPlayerProps) {
  const innerRef = useRef<HTMLAudioElement | null>(null);

  const setRef = useCallback(
    (el: HTMLAudioElement | null) => {
      innerRef.current = el;
      if (audioRef) audioRef.current = el;
    },
    [audioRef]
  );

  const [loadPct, setLoadPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [failed, setFailed] = useState(false);

  // A fresh recording starts its own load cycle.
  useEffect(() => {
    setLoadPct(0);
    setReady(false);
    setStalled(false);
    setFailed(false);
  }, [src]);

  const updateProgress = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const dur = el.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    let buffered = 0;
    for (let i = 0; i < el.buffered.length; i++) {
      buffered = Math.max(buffered, el.buffered.end(i));
    }
    const pct = Math.round((buffered / dur) * 100);
    setLoadPct(Math.min(100, Math.max(0, pct)));
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const el = innerRef.current;
    updateProgress();
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) {
      onDurationKnown?.(el.duration);
    }
  }, [onDurationKnown, updateProgress]);

  const retry = () => {
    const el = innerRef.current;
    if (!el) return;
    setFailed(false);
    setLoadPct(0);
    el.load();
  };

  // Only speak up while there is something to say: before the file can play, or
  // when playback has run out of buffer mid-way.
  const showLoading = !failed && (!ready || stalled);

  return (
    <div className={className}>
      <audio
        ref={setRef}
        src={src}
        controls
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={updateProgress}
        onProgress={updateProgress}
        onLoadedData={updateProgress}
        onCanPlay={() => {
          setReady(true);
          setStalled(false);
          setFailed(false);
          updateProgress();
        }}
        onWaiting={() => setStalled(true)}
        onStalled={() => setStalled(true)}
        onPlaying={() => {
          setStalled(false);
          updateProgress();
        }}
        onTimeUpdate={updateProgress}
        onError={() => {
          setFailed(true);
          setStalled(false);
        }}
        className="w-full"
      />

      {showLoading && (
        <div className="mt-1.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            <span className="text-[11px] tabular-nums text-slate-500">
              {stalled ? "กำลังบัฟเฟอร์เสียงพากย์" : "กำลังโหลดเสียงพากย์"} {loadPct}%
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${loadPct}%` }}
            />
          </div>
        </div>
      )}

      {failed && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-red-500">โหลดเสียงพากย์ไม่สำเร็จ</p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            ลองใหม่
          </button>
        </div>
      )}
    </div>
  );
}
