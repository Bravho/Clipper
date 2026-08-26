"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aspectRatioClass } from "@/lib/aspectRatio";

/**
 * Playable, draggable clip-trim bar for the scene editor.
 *
 * Renders one uploaded VIDEO clip as a scrubbable timeline (with a sampled
 * thumbnail filmstrip when the CDN allows canvas capture, otherwise a plain
 * bar), two draggable in/out handles, and a looping preview that plays only the
 * selected window. The clip's on-screen play time in the montage is the width
 * of the selected window (out - in), so dragging the handles directly sets how
 * long the clip plays. Emits `onChange({ start, end })` in seconds on release.
 *
 * When the clip has no saved trim yet, the whole timeline is selected by default
 * so the user can shorten it from either end - and that default window is
 * COMMITTED upward immediately via `onChange`, so the plan always stores exactly
 * what the bar displays. (Leaving it implicit is what previously let the
 * renderer cut a clip down to the AI's much shorter allotted slot.)
 *
 * MEDIA BUDGET - why this component is so careful about when it loads.
 * A scene may hold several clips and a request may hold several scenes, so a
 * naive "one <video src> per card" page asks Android's WebView for a dozen
 * simultaneous hardware decoders. Past the pool limit (C2_NO_MEMORY) the losing
 * elements never decode a frame: they sit on the grey placeholder, `play()`
 * resolves without anything moving, and the only picture actually moving on
 * screen is whichever card won a decoder - which reads to the user as "I
 * pressed play on this clip and a different one played". Three rules prevent it:
 *
 *   1. `sourceDurationSeconds` (probed at upload) seeds the timeline, so the bar
 *      is fully usable WITHOUT downloading the clip at all.
 *   2. The preview attaches its `src` only once the user asks to play it, and
 *      exactly one preview on the page is armed at a time - claiming playback
 *      stops and releases every other card.
 *   3. Filmstrip sampling runs through a page-wide serial queue, one detached
 *      capture element at a time, and only for cards scrolled into view.
 */

const MIN_WINDOW_SECONDS = 0.5;
const FILMSTRIP_FRAMES = 6;
const FILMSTRIP_TIMEOUT_MS = 12000;

/* ───────────────────────── page-wide playback coordinator ───────────────── */

interface PreviewHandle {
  /** Pause playback and reflect that in this card's own button. */
  stop: () => void;
  /** Detach the media element's source, handing the decoder back. */
  release: () => void;
}

const registeredPreviews = new Set<PreviewHandle>();

function registerPreview(handle: PreviewHandle): () => void {
  registeredPreviews.add(handle);
  return () => {
    registeredPreviews.delete(handle);
  };
}

/** Give `handle` the page's single playback slot; quiet everyone else. */
function claimPlayback(handle: PreviewHandle): void {
  registeredPreviews.forEach((other) => {
    if (other === handle) return;
    other.stop();
    other.release();
  });
}

/* ───────────────────────── page-wide filmstrip queue ────────────────────── */

let filmstripQueue: Promise<void> = Promise.resolve();

function enqueueFilmstrip(task: () => Promise<void>): void {
  filmstripQueue = filmstripQueue.then(task).catch(() => undefined);
}

/* ─────────────────────────────────────────────────────────────────────────── */

export interface ClipTrimBarProps {
  url: string;
  /** Poster JPEG generated at upload. Shown until the clip is armed, so the
   *  card has a real frame instead of the browser's grey placeholder. */
  posterUrl?: string | null;
  /** True clip length probed at upload. When present the timeline renders
   *  immediately and the clip itself is never downloaded until it is played. */
  sourceDurationSeconds?: number | null;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  /** Aspect ratio of the user's selected primary distribution channel (e.g.
   *  "9:16" for TikTok, "16:9" for YouTube). The preview is framed to this so it
   *  matches how the clip will appear in the final channel-shaped video. */
  aspectRatio?: string | null;
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
  posterUrl,
  sourceDurationSeconds,
  trimStartSeconds,
  trimEndSeconds,
  aspectRatio,
  onChange,
}: ClipTrimBarProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<"start" | "end" | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const probedDuration =
    typeof sourceDurationSeconds === "number" &&
    Number.isFinite(sourceDurationSeconds) &&
    sourceDurationSeconds > 0
      ? sourceDurationSeconds
      : null;

  const [duration, setDuration] = useState<number | null>(probedDuration);
  const [start, setStart] = useState<number>(trimStartSeconds ?? 0);
  const [end, setEnd] = useState<number>(trimEndSeconds ?? 0);
  const trimWindowRef = useRef({
    start: trimStartSeconds ?? 0,
    end: trimEndSeconds ?? 0,
  });
  const [playhead, setPlayhead] = useState<number>(trimStartSeconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [filmstripFailed, setFilmstripFailed] = useState(false);

  // Media lifecycle: `armed` = the <video> currently holds this clip's source.
  const [armed, setArmed] = useState(false);
  const [wantPlay, setWantPlay] = useState(false);
  const [canPlay, setCanPlay] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const wantPlayRef = useRef(false);
  wantPlayRef.current = wantPlay;
  const durationRef = useRef<number | null>(duration);
  durationRef.current = duration;

  /* ── seeding the selected window ─────────────────────────────────────────
   * Runs off the upload-probed length when we have one, and off <video>
   * metadata otherwise, so a clip that was never probed still works. */
  const seededRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const seed = useCallback(
    (dur: number) => {
      if (!Number.isFinite(dur) || dur <= 0) return;
      setDuration(dur);
      if (seededRef.current) return;
      seededRef.current = true;
      const s = clamp(trimStartSeconds ?? 0, 0, Math.max(0, dur - MIN_WINDOW_SECONDS));
      const hasSavedWindow =
        Number.isFinite(trimEndSeconds) && (trimEndSeconds as number) > s;
      const seededEnd = hasSavedWindow ? (trimEndSeconds as number) : dur;
      const e = clamp(seededEnd, s + MIN_WINDOW_SECONDS, dur);
      trimWindowRef.current = { start: s, end: e };
      setStart(s);
      setEnd(e);
      setPlayhead(s);
      // COMMIT the default full-clip window upward. The bar renders the whole
      // timeline as selected when a clip has no saved trim, so leaving it
      // untouched reads as "approve the clip at full length" - but without this
      // the scene plan kept the AI's much shorter allotted slot and the renderer
      // cut the clip. What is shown selected is now always what is stored.
      if (!hasSavedWindow) {
        onChangeRef.current({ start: round2(s), end: round2(e) });
      }
    },
    [trimStartSeconds, trimEndSeconds]
  );

  useEffect(() => {
    if (probedDuration != null) seed(probedDuration);
  }, [probedDuration, seed]);

  const handleLoadedMetadata = useCallback(() => {
    const el = previewRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    seed(el.duration);
  }, [seed]);

  // Reflect external trim edits (e.g. a scene rebuild) once seeded.
  useEffect(() => {
    if (!seededRef.current || duration == null || dragRef.current) return;
    const nextStart = Number.isFinite(trimStartSeconds)
      ? clamp(
        trimStartSeconds as number,
        0,
        Math.max(0, duration - MIN_WINDOW_SECONDS)
      )
      : 0;
    const savedEnd =
      Number.isFinite(trimEndSeconds) && (trimEndSeconds as number) > nextStart
        ? (trimEndSeconds as number)
        : duration;
    const nextEnd = clamp(savedEnd, nextStart + MIN_WINDOW_SECONDS, duration);
    trimWindowRef.current = { start: nextStart, end: nextEnd };
    setStart(nextStart);
    setEnd(nextEnd);
  }, [trimStartSeconds, trimEndSeconds, duration]);

  /* ── visibility: nothing downloads for a card the user hasn't reached ──── */
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // A clip with no probed length must load metadata to fill in the timeline -
  // but only once it is on screen, and only far enough to read the duration.
  useEffect(() => {
    if (visible && durationRef.current == null) setArmed(true);
  }, [visible]);

  /* ── register with the page-wide coordinator ─────────────────────────────
   * `release()` is refused while this card is still the only place its length
   * can come from, so freeing decoders can never blank out a timeline. */
  const handleRef = useRef<PreviewHandle | null>(null);
  useEffect(() => {
    const handle: PreviewHandle = {
      stop: () => {
        setWantPlay(false);
        previewRef.current?.pause();
        setIsPlaying(false);
      },
      release: () => {
        if (durationRef.current == null) return;
        setArmed(false);
      },
    };
    handleRef.current = handle;
    return registerPreview(handle);
  }, []);

  /* ── attach / detach the media source ────────────────────────────────────
   * Done imperatively: removing React's `src` prop would leave the previously
   * loaded resource live, because dropping the attribute does not re-run the
   * media load algorithm. */
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    if (!armed) {
      if (el.getAttribute("src")) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      setCanPlay(false);
      setStalled(false);
      setLoadPct(0);
      return;
    }
    if (el.getAttribute("src") !== url) {
      el.src = url;
      el.load();
    }
  }, [armed, url]);

  // Release this card's decoder when it unmounts (scene edited, step advanced).
  useEffect(() => {
    return () => {
      const el = previewRef.current;
      if (el && el.getAttribute("src")) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    };
  }, []);

  /* ── the actual play attempt ─────────────────────────────────────────────
   * Split from the click so a tap on a not-yet-loaded clip still plays as soon
   * as it can, instead of silently doing nothing. */
  useEffect(() => {
    if (!wantPlay || !armed) return;
    const el = previewRef.current;
    if (!el) return;
    let cancelled = false;

    const attempt = () => {
      if (cancelled || !wantPlayRef.current) return;
      if (el.readyState < 1) return; // no metadata yet - wait for the event
      const { start: s, end: e } = trimWindowRef.current;
      if (e > s && (el.currentTime < s || el.currentTime >= e)) {
        try {
          el.currentTime = s;
        } catch {
          /* seek before metadata - the loadedmetadata retry covers it */
        }
      }
      void el
        .play()
        .then(() => {
          if (!cancelled) setIsPlaying(true);
        })
        .catch(() => {
          if (cancelled) return;
          setWantPlay(false);
          setIsPlaying(false);
          setMediaError("เล่นคลิปนี้ไม่ได้ ลองกดใหม่อีกครั้ง");
        });
    };

    attempt();
    el.addEventListener("loadedmetadata", attempt);
    el.addEventListener("canplay", attempt);
    return () => {
      cancelled = true;
      el.removeEventListener("loadedmetadata", attempt);
      el.removeEventListener("canplay", attempt);
    };
  }, [wantPlay, armed]);

  const togglePlay = () => {
    if (isPlaying || wantPlay) {
      setWantPlay(false);
      previewRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    // Take the page's single playback slot BEFORE arming, so no two clips can
    // ever be loaded - let alone playing - at the same time.
    if (handleRef.current) claimPlayback(handleRef.current);
    setMediaError(null);
    setArmed(true);
    setWantPlay(true);
  };

  /* ── buffering / progress reporting ──────────────────────────────────────
   * Percentage is real: how far `buffered` reaches over the clip's length. */
  const updateProgress = useCallback(() => {
    const el = previewRef.current;
    if (!el) return;
    const dur =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationRef.current;
    if (!dur || dur <= 0) return;
    let buffered = 0;
    for (let i = 0; i < el.buffered.length; i++) {
      buffered = Math.max(buffered, el.buffered.end(i));
    }
    setLoadPct(clamp(Math.round((buffered / dur) * 100), 0, 100));
  }, []);

  // Looping preview: keep the playhead within the selected window.
  const handleTimeUpdate = useCallback(() => {
    const el = previewRef.current;
    if (!el) return;
    const { start: s, end: e } = trimWindowRef.current;
    if (e > s && el.currentTime >= e) {
      el.currentTime = s;
    }
    setPlayhead(el.currentTime);
  }, []);

  /* ── filmstrip sampling (serialised, on-screen cards only) ───────────────
   * Uses a detached video+canvas and seeks frame-by-frame; if the CDN response
   * taints the canvas (no CORS) we fall back to a plain gradient bar. One clip
   * is sampled at a time page-wide so this never competes with the preview for
   * decoders or bandwidth. */
  useEffect(() => {
    if (!visible || duration == null) return;
    if (frames.length > 0 || filmstripFailed) return;

    let cancelled = false;

    enqueueFilmstrip(
      () =>
        new Promise<void>((resolve) => {
          if (cancelled) {
            resolve();
            return;
          }

          const capture = document.createElement("video");
          capture.crossOrigin = "anonymous";
          capture.muted = true;
          // metadata (not auto) so we don't eagerly download the whole clip -
          // seeking fetches only the byte ranges each frame needs.
          capture.preload = "metadata";

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
          let done = false;

          const finish = () => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            capture.removeEventListener("loadeddata", onLoaded);
            capture.removeEventListener("seeked", onSeeked);
            capture.removeEventListener("error", onError);
            capture.removeAttribute("src");
            capture.load();
            resolve();
          };

          const seekNext = () => {
            if (cancelled || done || idx >= times.length) return;
            capture.currentTime = Math.min(times[idx], Math.max(0, duration - 0.05));
          };

          const onSeeked = () => {
            if (cancelled || done || !ctx) {
              finish();
              return;
            }
            try {
              ctx.drawImage(capture, 0, 0, canvas.width, canvas.height);
              collected.push(canvas.toDataURL("image/jpeg", 0.6));
            } catch {
              setFilmstripFailed(true);
              finish();
              return;
            }
            idx += 1;
            if (idx >= times.length) {
              setFrames(collected);
              finish();
            } else {
              seekNext();
            }
          };

          const onError = () => {
            if (!cancelled) setFilmstripFailed(true);
            finish();
          };

          const onLoaded = () => seekNext();

          // A clip that never seeks must not wedge the page-wide queue.
          const timer = window.setTimeout(() => {
            if (!cancelled && collected.length === 0) setFilmstripFailed(true);
            finish();
          }, FILMSTRIP_TIMEOUT_MS);

          capture.addEventListener("loadeddata", onLoaded, { once: true });
          capture.addEventListener("seeked", onSeeked);
          capture.addEventListener("error", onError);
          capture.src = url;
        })
    );

    return () => {
      cancelled = true;
    };
  }, [visible, duration, url, frames.length, filmstripFailed]);

  const timeFromClientX = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar || duration == null) return 0;
    const rect = bar.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * duration;
  }, [duration]);

  const onHandleMove = useCallback(
    (clientX: number) => {
      if (!dragRef.current || duration == null) return;
      const t = timeFromClientX(clientX);
      if (dragRef.current === "start") {
        const nextStart = clamp(
          t,
          0,
          trimWindowRef.current.end - MIN_WINDOW_SECONDS
        );
        trimWindowRef.current = {
          ...trimWindowRef.current,
          start: nextStart,
        };
        setStart(nextStart);
      } else {
        const nextEnd = clamp(
          t,
          trimWindowRef.current.start + MIN_WINDOW_SECONDS,
          duration
        );
        trimWindowRef.current = {
          ...trimWindowRef.current,
          end: nextEnd,
        };
        setEnd(nextEnd);
      }
    },
    [duration, timeFromClientX]
  );

  // Pointer capture keeps mobile Chrome delivering move/up events even when the
  // finger leaves the narrow handle. The ref carries the exact last position,
  // avoiding a stale React-state value on a fast release.
  const finishDrag = useCallback(
    (pointerId: number, target: HTMLDivElement) => {
      if (!dragRef.current || pointerIdRef.current !== pointerId) return;
      dragRef.current = null;
      pointerIdRef.current = null;
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      onChange({
        start: round2(trimWindowRef.current.start),
        end: round2(trimWindowRef.current.end),
      });
    },
    [onChange]
  );

  const windowSeconds = Math.max(0, end - start);
  const pct = (t: number) => (duration && duration > 0 ? (t / duration) * 100 : 0);

  const waiting = wantPlay && (!canPlay || stalled);
  const showPoster = !armed || !canPlay;

  return (
    <div className="mt-2 w-full" ref={containerRef}>
      {/* Preview framed to the selected primary channel's aspect ratio, so the
          clip is shown cropped exactly as it will appear in the final video. */}
      <div className="mb-2 flex justify-center">
        <div
          className={`relative ${aspectRatioClass(aspectRatio)} h-60 max-w-full overflow-hidden rounded-md bg-black`}
        >
          <video
            ref={previewRef}
            poster={posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onProgress={updateProgress}
            onLoadedData={() => {
              updateProgress();
              setStalled(false);
            }}
            onCanPlay={() => {
              setCanPlay(true);
              setStalled(false);
              updateProgress();
            }}
            onWaiting={() => setStalled(true)}
            onPlaying={() => {
              setStalled(false);
              setIsPlaying(true);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => {
              setWantPlay(false);
              setIsPlaying(false);
              setMediaError("โหลดคลิปไม่สำเร็จ");
            }}
            onEnded={() => {
              const el = previewRef.current;
              if (!el || !wantPlayRef.current) return;
              el.currentTime = trimWindowRef.current.start;
              void el.play().catch(() => undefined);
            }}
            className="h-full w-full object-cover"
          />

          {/* Poster stand-in while nothing is decoded yet. The generated JPEG is
              already on the <video> as `poster`; this covers the clips that have
              no poster (grey placeholder) with something readable. */}
          {showPoster && !posterUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-800 text-xs text-slate-300">
              คลิป
            </div>
          )}

          {/* Tap-the-picture play affordance / buffering state. Only one clip on
              the page can be armed, so this is always about THIS card. */}
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "หยุดคลิป" : "เล่นคลิป"}
            className="absolute inset-0 flex items-center justify-center focus:outline-none"
          >
            {waiting ? (
              <span className="flex flex-col items-center gap-2 rounded-lg bg-black/60 px-4 py-3">
                <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span className="text-[11px] font-medium tabular-nums text-white">
                  กำลังโหลด {loadPct}%
                </span>
              </span>
            ) : !isPlaying ? (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-2xl text-white">
                ▶
              </span>
            ) : null}
          </button>

          {/* Thin buffered-progress strip along the bottom of the picture. */}
          {armed && loadPct > 0 && loadPct < 100 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <div className="h-full bg-blue-400 transition-all" style={{ width: `${loadPct}%` }} />
            </div>
          )}
        </div>
      </div>

      {mediaError && (
        <p className="mb-1 text-[11px] text-red-500">{mediaError}</p>
      )}

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
                pointerIdRef.current = e.pointerId;
                trimWindowRef.current = { start, end };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (pointerIdRef.current !== e.pointerId) return;
                e.preventDefault();
                onHandleMove(e.clientX);
              }}
              onPointerUp={(e) => finishDrag(e.pointerId, e.currentTarget)}
              onPointerCancel={(e) => finishDrag(e.pointerId, e.currentTarget)}
              className="absolute inset-y-0 -ml-3 flex w-6 touch-none cursor-ew-resize items-stretch justify-center"
              style={{ left: `${pct(start)}%` }}
            >
              <span className="block h-full w-3 rounded-sm bg-blue-500 shadow" />
            </div>
            {/* End handle */}
            <div
              role="slider"
              aria-label="จุดจบคลิป"
              aria-valuenow={round2(end)}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = "end";
                pointerIdRef.current = e.pointerId;
                trimWindowRef.current = { start, end };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (pointerIdRef.current !== e.pointerId) return;
                e.preventDefault();
                onHandleMove(e.clientX);
              }}
              onPointerUp={(e) => finishDrag(e.pointerId, e.currentTarget)}
              onPointerCancel={(e) => finishDrag(e.pointerId, e.currentTarget)}
              className="absolute inset-y-0 -ml-3 flex w-6 touch-none cursor-ew-resize items-stretch justify-center"
              style={{ left: `${pct(end)}%` }}
            >
              <span className="block h-full w-3 rounded-sm bg-blue-500 shadow" />
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <button
              type="button"
              onClick={togglePlay}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
            >
              {isPlaying ? "⏸ หยุด" : waiting ? `⏳ กำลังโหลด ${loadPct}%` : "▶ เล่นช่วงที่เลือก"}
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
