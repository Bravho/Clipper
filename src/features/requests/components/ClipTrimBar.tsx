"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Playable, draggable clip-trim bar for the scene editor.
 *
 * Renders one uploaded VIDEO clip as a scrubbable timeline (with a sampled
 * thumbnail filmstrip when the CDN allows canvas capture, otherwise a plain
 * bar), two draggable in/out handles, and a looping preview that plays only the
 * selected window. The clip's on-screen play time in the montage is the width
 * of the selected window (out − in), so dragging the handles directly sets how
 * long the clip plays. Emits `onChange({ start, end })` in seconds on release.
 *
 * The true clip length is read client-side from `<video>` metadata (the model's
 * OrderedSourceAsset carries no duration). `playSeconds` seeds the out handle
 * when the clip has no trim yet, so the bar opens reflecting the current
 * on-screen duration rather than the whole file.
 */

const MIN_WINDOW_SECONDS = 0.5;
const FILMSTRIP_FRAMES = 6;

export interface ClipTrimBarProps {
  url: string;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  /** Current on-screen play seconds; seeds the out handle when trims are unset. */
  playSeconds?: number;
  onChange: (trim: { start: number; end: number }) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function ClipTrimBar({
  url,
  trimStartSeconds,
  trimEndSeconds,
  playSeconds,
  onChange,
}: ClipTrimBarProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<"start" | "end" | null>(null);

  const [duration, setDuration] = useState<number | null>(null);
  const [start, setStart] = useState<number>(trimStartSeconds ?? 0);
  const [end, setEnd] = useState<number>(trimEndSeconds ?? 0);
  const [playhead, setPlayhead] = useState<number>(trimStartSeconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [filmstripFailed, setFilmstripFailed] = useState(false);

  // Seed the window once we know the real clip length. Prefer explicit trims;
  // otherwise open on [0, playSeconds] (falling back to the whole clip).
  const seededRef = useRef(false);
  const handleLoadedMetadata = useCallback(() => {
    const el = previewRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const dur = el.duration;
    setDuration(dur);
    if (seededRef.current) return;
    seededRef.current = true;
    const s = clamp(trimStartSeconds ?? 0, 0, Math.max(0, dur - MIN_WINDOW_SECONDS));
    const seededEnd =
      Number.isFinite(trimEndSeconds) && (trimEndSeconds as number) > s
        ? (trimEndSeconds as number)
        : s + (Number.isFinite(playSeconds) && (playSeconds as number) > 0 ? (playSeconds as number) : dur);
    const e = clamp(seededEnd, s + MIN_WINDOW_SECONDS, dur);
    setStart(s);
    setEnd(e);
    setPlayhead(s);
  }, [trimStartSeconds, trimEndSeconds, playSeconds]);

  // Reflect external trim edits (e.g. a scene rebuild) once seeded.
  useEffect(() => {
    if (!seededRef.current || duration == null) return;
    if (Number.isFinite(trimStartSeconds)) {
      setStart(clamp(trimStartSeconds as number, 0, Math.max(0, duration - MIN_WINDOW_SECONDS)));
    }
    if (Number.isFinite(trimEndSeconds)) {
      setEnd(clamp(trimEndSeconds as number, MIN_WINDOW_SECONDS, duration));
    }
  }, [trimStartSeconds, trimEndSeconds, duration]);

  // Sample thumbnail frames for the filmstrip. Uses a detached video+canvas and
  // seeks frame-by-frame; if the CDN response taints the canvas (no CORS), we
  // fall back to a plain gradient bar instead of throwing.
  useEffect(() => {
    if (duration == null) return;
    let cancelled = false;
    const capture = document.createElement("video");
    capture.crossOrigin = "anonymous";
    capture.muted = true;
    // metadata (not auto) so we don't eagerly download the whole clip — seeking
    // fetches only the byte ranges each frame needs. Eager full downloads across
    // several trim bars exhaust the browser's video decoders and stall previews.
    capture.preload = "metadata";
    capture.src = url;

    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 54;
    const ctx = canvas.getContext("2d");

    const times = Array.from(
      { length: FILMSTRIP_FRAMES },
      (_, i) => ((i + 0.5) / FILMSTRIP_FRAMES) * duration
    );

    const collected: string[] = [];
    let idx = 0;

    const seekNext = () => {
      if (cancelled || idx >= times.length) return;
      capture.currentTime = Math.min(times[idx], Math.max(0, duration - 0.05));
    };

    const onSeeked = () => {
      if (cancelled || !ctx) return;
      try {
        ctx.drawImage(capture, 0, 0, canvas.width, canvas.height);
        collected.push(canvas.toDataURL("image/jpeg", 0.6));
      } catch {
        if (!cancelled) setFilmstripFailed(true);
        cleanup();
        return;
      }
      idx += 1;
      if (idx >= times.length) {
        if (!cancelled) setFrames(collected);
        cleanup();
      } else {
        seekNext();
      }
    };

    const onError = () => {
      if (!cancelled) setFilmstripFailed(true);
      cleanup();
    };

    const cleanup = () => {
      capture.removeEventListener("seeked", onSeeked);
      capture.removeEventListener("error", onError);
      capture.removeAttribute("src");
      capture.load();
    };

    const onLoaded = () => seekNext();
    capture.addEventListener("loadeddata", onLoaded, { once: true });
    capture.addEventListener("seeked", onSeeked);
    capture.addEventListener("error", onError);

    return () => {
      cancelled = true;
      capture.removeEventListener("loadeddata", onLoaded);
      cleanup();
    };
  }, [url, duration]);

  // Looping preview: keep the playhead within the selected window.
  const handleTimeUpdate = useCallback(() => {
    const el = previewRef.current;
    if (!el) return;
    if (el.currentTime >= end) {
      el.currentTime = start;
    }
    setPlayhead(el.currentTime);
  }, [start, end]);

  const togglePlay = () => {
    const el = previewRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      if (el.currentTime < start || el.currentTime >= end) el.currentTime = start;
      void el.play();
      setIsPlaying(true);
    }
  };

  const timeFromClientX = (clientX: number): number => {
    const bar = barRef.current;
    if (!bar || duration == null) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * duration;
  };

  const onHandleMove = useCallback(
    (clientX: number) => {
      if (!dragRef.current || duration == null) return;
      const t = timeFromClientX(clientX);
      if (dragRef.current === "start") {
        setStart(clamp(t, 0, end - MIN_WINDOW_SECONDS));
      } else {
        setEnd(clamp(t, start + MIN_WINDOW_SECONDS, duration));
      }
    },
    [duration, start, end]
  );

  // Global pointer listeners while dragging a handle.
  useEffect(() => {
    const move = (e: PointerEvent) => onHandleMove(e.clientX);
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      onChange({ start: round2(start), end: round2(end) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onHandleMove, onChange, start, end]);

  const windowSeconds = Math.max(0, end - start);
  const pct = (t: number) => (duration && duration > 0 ? (t / duration) * 100 : 0);

  return (
    <div className="mt-2 w-full">
      <video
        ref={previewRef}
        src={url}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          const el = previewRef.current;
          if (el) {
            el.currentTime = start;
            void el.play();
          }
        }}
        className="mb-2 max-h-40 w-full rounded-md bg-black object-contain"
      />

      {duration == null ? (
        <p className="text-[11px] text-slate-400">กำลังโหลดคลิป…</p>
      ) : (
        <>
          <div
            ref={barRef}
            className="relative h-12 w-full select-none overflow-hidden rounded-md border border-slate-200 bg-slate-800"
          >
            {/* Filmstrip (or gradient fallback) */}
            <div className="absolute inset-0 flex">
              {frames.length > 0 && !filmstripFailed ? (
                frames.map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={f} alt="" className="h-full flex-1 object-cover" draggable={false} />
                ))
              ) : (
                <div className="h-full w-full bg-gradient-to-r from-slate-700 to-slate-600" />
              )}
            </div>

            {/* Dim outside the selected window */}
            <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${pct(start)}%` }} />
            <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${100 - pct(end)}%` }} />

            {/* Selected window border */}
            <div
              className="pointer-events-none absolute inset-y-0 border-2 border-blue-400"
              style={{ left: `${pct(start)}%`, width: `${Math.max(0, pct(end) - pct(start))}%` }}
            />

            {/* Playhead */}
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
              style={{ left: `${pct(playhead)}%` }}
            />

            {/* Start handle */}
            <div
              role="slider"
              aria-label="จุดเริ่มคลิป"
              aria-valuenow={round2(start)}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = "start";
              }}
              className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-blue-500 shadow"
              style={{ left: `${pct(start)}%` }}
            />
            {/* End handle */}
            <div
              role="slider"
              aria-label="จุดจบคลิป"
              aria-valuenow={round2(end)}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = "end";
              }}
              className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-sm bg-blue-500 shadow"
              style={{ left: `${pct(end)}%` }}
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
            >
              {isPlaying ? "⏸ หยุด" : "▶ เล่นช่วงที่เลือก"}
            </button>
            <span className="tabular-nums">
              เริ่ม {round2(start)} วิ · จบ {round2(end)} วิ · ยาว{" "}
              <span className="font-semibold text-slate-700">{round2(windowSeconds)}</span> วิ
            </span>
          </div>
        </>
      )}
    </div>
  );
}
