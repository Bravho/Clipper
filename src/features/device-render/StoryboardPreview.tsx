"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { MotionPreset } from "@/config/montage";
import { aspectOfRatio, framePlacement } from "@/lib/mobile/shotFraming";
import {
  findSource,
  shotFrameZoom,
  type EditorDocument,
  type EditorSource,
} from "./editorState";

/**
 * Where the picture sits in the preview frame, exactly as the renderer will
 * place it (whole picture, filled, or in between, kept on its focus point).
 * Unknown shape → the plain cover crop the renderer also falls back to.
 */
export function framingStyle(
  aspect: number | null | undefined,
  ratio: string,
  frameZoom: number,
  focusX: number,
  focusY: number
): CSSProperties | undefined {
  if (!aspect) return undefined;
  const canvasAspect = aspectOfRatio(ratio);
  const placed = framePlacement(
    { width: aspect, height: 1 },
    { width: canvasAspect, height: 1 },
    frameZoom,
    focusX,
    focusY
  );
  return {
    left: `${(placed.x / canvasAspect) * 100}%`,
    top: `${placed.y * 100}%`,
    width: `${(placed.width / canvasAspect) * 100}%`,
    height: `${placed.height * 100}%`,
    right: "auto",
    bottom: "auto",
    objectFit: "fill",
  };
}

/**
 * Play the storyboard, in the WebView, before anything is rendered.
 *
 * WHAT THIS IS. A live approximation of the edit: every shot in order, clips
 * playing only their trimmed window (slowed when the slot is longer than the
 * window, exactly as the renderer does), photos moving with their camera move
 * around their focus point, scenes fading in unless they cut. It is what makes
 * trimming feel like editing instead of typing numbers.
 *
 * WHAT IT IS NOT. The export. There are no captions, no template and no voice
 * here — those are burned in natively, from the approved script and style, by
 * the renderer. The on-screen note says so, because a preview that is mistaken
 * for the result is how people approve the wrong thing.
 *
 * ONE DECODER. A single `<video>` element is reused for every clip and its
 * source is detached whenever playback stops. Android's WebView has a small
 * hardware-decoder pool, and a preview that held one per clip would starve the
 * trim bars below it.
 */

interface PreviewShot {
  source: EditorSource;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  motion: MotionPreset;
  focusX: number;
  focusY: number;
  frameZoom: number;
  sceneIndex: number;
  fadeIn: boolean;
  startsAt: number;
}

/** Start and end transforms for a camera move, in the renderer's spirit. */
function motionFrames(motion: MotionPreset): [string, string] {
  switch (motion) {
    case "ken_burns_in":
      return ["scale(1)", "scale(1.15)"];
    case "ken_burns_out":
      return ["scale(1.15)", "scale(1)"];
    case "pan_left":
      return ["scale(1.12) translateX(4%)", "scale(1.12) translateX(-4%)"];
    case "pan_right":
      return ["scale(1.12) translateX(-4%)", "scale(1.12) translateX(4%)"];
    default:
      return ["scale(1)", "scale(1)"];
  }
}

function ratioValue(ratio: string): string {
  const [w, h] = ratio.split(":");
  return `${w} / ${h}`;
}

export function StoryboardPreview({
  document,
  jump,
}: {
  document: EditorDocument;
  /** Start playback at this flat shot index; `nonce` makes a repeat tap count. */
  jump: { index: number; nonce: number } | null;
}) {
  const shots = useMemo<PreviewShot[]>(() => {
    const list: PreviewShot[] = [];
    let cursor = 0;
    document.scenes.forEach((scene, sceneIndex) => {
      scene.shots.forEach((shot, shotIndex) => {
        const source = findSource(document, shot.sourceId);
        if (!source || !(shot.durationSeconds > 0)) return;
        list.push({
          source,
          durationSeconds: shot.durationSeconds,
          trimStartSeconds: shot.trimStartSeconds,
          trimEndSeconds: shot.trimEndSeconds,
          motion: shot.motion,
          focusX: shot.focusX,
          focusY: shot.focusY,
          frameZoom: shotFrameZoom(shot, source, document.ratio),
          sceneIndex,
          fadeIn: list.length > 0 && !(shotIndex === 0 && scene.transitionIn === "cut"),
          startsAt: cursor,
        });
        cursor += shot.durationSeconds;
      });
    });
    return list;
  }, [document]);

  const total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const shotStartedAt = useRef(0);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const current = shots[Math.min(index, Math.max(0, shots.length - 1))];

  const clearClock = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    timerRef.current = null;
    rafRef.current = null;
  }, []);

  const releaseVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, []);

  const stop = useCallback(() => {
    clearClock();
    releaseVideo();
    setPlaying(false);
  }, [clearClock, releaseVideo]);

  /** Put shot `at` on screen and, if playing, run it for its slot. */
  const showShot = useCallback(
    (at: number, play: boolean) => {
      clearClock();
      const shot = shots[at];
      if (!shot) {
        stop();
        setIndex(0);
        setElapsed(0);
        return;
      }
      setIndex(at);
      setElapsed(shot.startsAt);

      const frame = frameRef.current;
      if (frame && shot.fadeIn && play) {
        frame.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: "linear" });
      }

      if (shot.source.kind === "clip") {
        const video = videoRef.current;
        if (video) {
          const end = shot.trimEndSeconds ?? shot.trimStartSeconds + shot.durationSeconds;
          const window = Math.max(0.1, end - shot.trimStartSeconds);
          // Slowed to fill a longer slot, as the renderer does — never sped up.
          const rate = Math.min(1, Math.max(0.25, window / shot.durationSeconds));
          if (video.getAttribute("src") !== shot.source.previewUrl) {
            video.src = shot.source.previewUrl;
          }
          const start = () => {
            video.currentTime = shot.trimStartSeconds;
            video.playbackRate = rate;
            if (play) void video.play().catch(() => undefined);
          };
          if (video.readyState >= 1) start();
          else video.onloadedmetadata = start;
        }
      } else {
        releaseVideo();
        const image = imageRef.current;
        if (image) {
          const [from, to] = motionFrames(shot.motion);
          image.style.transformOrigin = `${shot.focusX * 100}% ${shot.focusY * 100}%`;
          image.getAnimations().forEach((animation) => animation.cancel());
          const animation = image.animate([{ transform: from }, { transform: to }], {
            duration: shot.durationSeconds * 1000,
            easing: "linear",
            fill: "forwards",
          });
          if (!play) animation.pause();
        }
      }

      if (!play) return;
      shotStartedAt.current = performance.now();
      const tick = () => {
        const into = (performance.now() - shotStartedAt.current) / 1000;
        setElapsed(shot.startsAt + Math.min(into, shot.durationSeconds));
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
      timerRef.current = window.setTimeout(() => {
        if (at + 1 < shots.length) showShot(at + 1, true);
        else {
          stop();
          setElapsed(total);
        }
      }, shot.durationSeconds * 1000);
    },
    [clearClock, releaseVideo, shots, stop, total]
  );

  const play = useCallback(
    (from?: number) => {
      const start = from ?? (index >= shots.length - 1 && elapsed >= total ? 0 : index);
      setPlaying(true);
      showShot(start, true);
    },
    [elapsed, index, shots.length, showShot, total]
  );

  // Any edit changes what "shot N" is; stop rather than play a stale plan.
  useEffect(() => {
    stop();
    setIndex((at) => Math.min(at, Math.max(0, shots.length - 1)));
  }, [shots, stop]);

  useEffect(() => {
    if (jump) play(jump.index);
    // Only a new jump request should start playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce]);

  useEffect(() => stop, [stop]);

  if (shots.length === 0) return null;

  const placement = current
    ? framingStyle(
        current.source.aspect,
        document.ratio,
        current.frameZoom,
        current.focusX,
        current.focusY
      )
    : undefined;

  return (
    <div className="studio-preview">
      <div
        ref={frameRef}
        className="studio-preview-frame"
        style={{ aspectRatio: ratioValue(document.ratio) }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          className="studio-preview-media"
          style={{
            ...placement,
            display: current?.source.kind === "clip" && playing ? "block" : "none",
          }}
        />
        {/* Always mounted, so a photo's camera move can start on the same
            element the moment its shot begins; hidden while a clip plays. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={current?.source.posterUrl ?? undefined}
          alt=""
          className="studio-preview-media"
          style={{
            ...placement,
            display:
              current?.source.posterUrl && !(current.source.kind === "clip" && playing)
                ? "block"
                : "none",
          }}
        />
        <button
          type="button"
          className="studio-preview-play"
          aria-label={playing ? "Pause the preview" : "Play the preview"}
          onClick={() => (playing ? stop() : play())}
        >
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        </button>
        <span className="studio-preview-badge">
          Scene {(current?.sceneIndex ?? 0) + 1} · shot {index + 1}/{shots.length}
        </span>
      </div>

      <div className="studio-preview-track" role="group" aria-label="Jump to a shot">
        {shots.map((shot, at) => (
          <button
            key={`${shot.source.id}-${at}`}
            type="button"
            className="studio-preview-seg"
            aria-current={at === index ? "true" : undefined}
            aria-label={`Play from shot ${at + 1}`}
            style={{ flexGrow: shot.durationSeconds }}
            onClick={() => play(at)}
          >
            <span
              className="studio-preview-seg-fill"
              style={{
                width:
                  at < index
                    ? "100%"
                    : at === index
                      ? `${Math.min(100, ((elapsed - shot.startsAt) / shot.durationSeconds) * 100)}%`
                      : "0%",
              }}
            />
          </button>
        ))}
      </div>
      <p className="studio-counter" style={{ textAlign: "left", marginTop: 6 }}>
        {elapsed.toFixed(1)}s / {total.toFixed(1)}s · picture only — the voice, captions and
        template are added when it renders.
      </p>
    </div>
  );
}
