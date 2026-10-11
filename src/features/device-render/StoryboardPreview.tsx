"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { MotionPreset } from "@/config/montage";
import { aspectOfRatio, fillCoverage, framePlacement } from "@/lib/mobile/shotFraming";
import { useStudioT } from "./studioI18n";
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
    // globals.css caps every img/video at max-width: 100% ("media should never
    // widen a layout"). A zoomed-in picture is MEANT to be wider than its
    // frame (the frame crops it), and the cap squeezed it sideways — the
    // wrong-proportion preview. The frame's overflow: hidden does the cropping.
    maxWidth: "none",
    maxHeight: "none",
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
  sceneId: string;
  shotId: string;
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
      return ["scale(1)", "scale(1.25)"];
    case "ken_burns_out":
      return ["scale(1.25)", "scale(1)"];
    // Same direction as the renderer's table (KEN_BURNS_KEYFRAMES).
    case "pan_left":
      return ["scale(1.18) translateX(-7%)", "scale(1.18) translateX(7%)"];
    case "pan_right":
      return ["scale(1.18) translateX(7%)", "scale(1.18) translateX(-7%)"];
    default:
      return ["scale(1)", "scale(1)"];
  }
}

/**
 * The box a preview is drawn in: EXACTLY the Main Video Shape, as large as fits.
 *
 * It used to be `aspect-ratio` plus a fixed height for portrait shapes and a
 * max-height for the rest. Whenever that height asked for more width than the
 * panel had (4:5 at 62vh is ~420px wide on a ~340px phone column; 1:1 on a
 * tablet hit the max-height), the browser kept the size limit and dropped the
 * ratio, so the preview was not the video's shape — and the framed picture,
 * positioned in percentages of that box, was squeezed with it. Driving only
 * the width (the smaller of "full width" and "the width the height cap
 * allows") and letting `aspect-ratio` derive the height cannot break the shape.
 */
export function previewBoxStyle(ratio: string, maxHeight: string): CSSProperties {
  const [w, h] = ratio.split(":").map(Number);
  const width = w > 0 && h > 0 ? w : 9;
  const height = w > 0 && h > 0 ? h : 16;
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, calc(${maxHeight} * ${width} / ${height}))`,
    height: "auto",
    maxHeight: "none",
  };
}

export function StoryboardPreview({
  document,
  jump,
  onFrameZoom,
  disabled = false,
}: {
  document: EditorDocument;
  /** Start playback at this flat shot index; `nonce` makes a repeat tap count. */
  jump: { index: number; nonce: number } | null;
  /**
   * Set the shown shot's zoom (0 = whole picture, 1 = fill the frame). When
   * given, a zoom bar appears under the preview for any shot whose picture is
   * not (nearly) the Main Video Shape — the same control as Framing.
   */
  onFrameZoom?: (sceneId: string, shotId: string, frameZoom: number) => void;
  disabled?: boolean;
}) {
  const t = useStudioT();
  const shots = useMemo<PreviewShot[]>(() => {
    const list: PreviewShot[] = [];
    let cursor = 0;
    document.scenes.forEach((scene, sceneIndex) => {
      scene.shots.forEach((shot, shotIndex) => {
        const source = findSource(document, shot.sourceId);
        if (!source || !(shot.durationSeconds > 0)) return;
        list.push({
          sceneId: scene.id,
          shotId: shot.id,
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

  // A clip with no poster frame (common on iOS) had nothing to show while the
  // preview was stopped — a black box, so its framing could not be judged or
  // zoomed. Cue the one video element on the shot's first kept frame instead.
  const idleCue =
    !playing && current?.source.kind === "clip" && !current.source.posterUrl ? current : null;
  useEffect(() => {
    if (!idleCue) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.getAttribute("src") !== idleCue.source.previewUrl) {
      video.preload = "auto";
      video.src = idleCue.source.previewUrl;
    }
    const cue = () => {
      try {
        video.currentTime = idleCue.trimStartSeconds + 0.01;
      } catch {
        /* not seekable yet */
      }
    };
    if (video.readyState >= 1) cue();
    else video.onloadedmetadata = cue;
  }, [idleCue]);

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

  // Same rule as Framing: a picture within 3% of the video's shape loses
  // nothing to the crop, so there is nothing to zoom.
  const zoomable =
    current?.source.aspect != null &&
    fillCoverage(current.source.aspect, aspectOfRatio(document.ratio)) < 0.97;

  return (
    <div className="studio-preview">
      <div
        ref={frameRef}
        className="studio-preview-frame"
        style={previewBoxStyle(document.ratio, "62vh")}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          className="studio-preview-media"
          style={{
            ...placement,
            display: current?.source.kind === "clip" && (playing || idleCue) ? "block" : "none",
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
          aria-label={playing ? t("studio.preview.pause") : t("studio.preview.play")}
          onClick={() => (playing ? stop() : play())}
        >
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        </button>
        <span className="studio-preview-badge">
          {t("studio.preview.badge", {
            scene: (current?.sceneIndex ?? 0) + 1,
            shot: index + 1,
            total: shots.length,
          })}
        </span>
      </div>

      <div className="studio-preview-track" role="group" aria-label={t("studio.preview.jump")}>
        {shots.map((shot, at) => (
          <button
            key={`${shot.source.id}-${at}`}
            type="button"
            className="studio-preview-seg"
            aria-current={at === index ? "true" : undefined}
            aria-label={t("studio.preview.playFrom", { number: at + 1 })}
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
      {onFrameZoom && current && zoomable && (
        <label className="studio-framing-zoom studio-preview-zoom">
          <span className="studio-shot-meta">
            {t("studio.preview.zoomFor", { shot: index + 1, ratio: document.ratio })}
            {" · "}
            {current.frameZoom <= 0.02
              ? t("studio.framing.whole")
              : current.frameZoom >= 0.98
                ? t("studio.framing.fills")
                : t("studio.framing.zoom", { percent: Math.round(current.frameZoom * 100) })}
          </span>
          <span className="studio-framing-ends">
            <span>{t("studio.framing.wholeShort")}</span>
            <input
              className="studio-range"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={current.frameZoom}
              disabled={disabled}
              aria-label={t("studio.framing.zoomAria")}
              onChange={(event) =>
                onFrameZoom(current.sceneId, current.shotId, Number(event.target.value))
              }
            />
            <span>{t("studio.framing.fillShort")}</span>
          </span>
        </label>
      )}
      <p className="studio-counter" style={{ textAlign: "left", marginTop: 6 }}>
        {elapsed.toFixed(1)}s / {total.toFixed(1)}s · picture only — the voice, captions and
        template are added when it renders.
      </p>
    </div>
  );
}
