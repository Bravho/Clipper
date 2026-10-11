"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EditorDocument } from "./editorState";
import { useStudioT } from "./studioI18n";
import { framingStyle } from "./StoryboardPreview";
import {
  buildSoundPreviewTimeline,
  clipRateFor,
  motionTransformAt,
  shotAt,
  voiceTimeAt,
} from "./soundPreviewTimeline";

/**
 * The voice and the storyboard, played together on the finished video's clock.
 *
 * The Sound step used to offer the voice on its own `<audio>` bar, so whether
 * the narration landed on the right pictures could only be judged after a
 * render. This is that bar with the picture attached: one transport drives the
 * voice, the background music and the storyboard (the same shots, trims,
 * camera moves and dissolves as the Storyboard preview), placed by
 * `buildSoundPreviewTimeline` exactly where the renderer places them —
 *
 *   picture from 0 · voice from the music lead-in (0.6 s with music) ·
 *   scene dissolves inside the shots (no added time) · black after the
 *   picture ends while the voice is still talking.
 *
 * So the preview's length IS the rendered video's length, and a line that
 * starts over the wrong shot here starts over the wrong shot there.
 *
 * Captions and the Look are still not drawn — they are burned in natively.
 *
 * ONE DECODER, as in StoryboardPreview: a single `<video>` is reused for every
 * clip and its source is detached whenever playback stops, so the Android
 * WebView's small hardware-decoder pool is never held by an idle preview.
 */

const DRIFT_SECONDS = 0.25;
/** Music bed level, and its level under speech (renderer: 0.3, ducked). */
const MUSIC_BED = 0.3;
const MUSIC_UNDER_VOICE = 0.18;

function ratioValue(ratio: string): string {
  const [w, h] = ratio.split(":");
  return `${w} / ${h}`;
}

function fmt(seconds: number): string {
  return seconds.toFixed(1);
}

export function SoundSyncPreview({
  document,
  voiceUrl,
  voiceSeconds,
  musicUrl,
}: {
  document: EditorDocument;
  voiceUrl: string;
  /** The voice's length from the server; measured from the file when null. */
  voiceSeconds: number | null;
  /** The chosen background track, or null for none. */
  musicUrl: string | null;
}) {
  const t = useStudioT();

  const [measuredVoice, setMeasuredVoice] = useState<number | null>(null);
  const voiceLength = voiceSeconds ?? measuredVoice;
  const timeline = useMemo(
    () => buildSoundPreviewTimeline(document, voiceLength),
    [document, voiceLength]
  );
  const total = timeline.totalSeconds;

  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const clockRef = useRef({ startedAtWall: 0, startedAtClock: 0 });
  const clipIdRef = useRef<string | null>(null);

  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);

  const current = shotAt(timeline, clock);
  const inBlackTail = timeline.blackTail != null && clock >= timeline.blackTail.start;
  const inLeadIn = timeline.leadInSeconds > 0 && clock < timeline.voiceStart;

  // ── media sync ──────────────────────────────────────────────────────────

  const releaseVideo = useCallback(() => {
    const video = videoRef.current;
    clipIdRef.current = null;
    if (!video) return;
    video.pause();
    video.onloadedmetadata = null;
    video.removeAttribute("src");
    video.load();
  }, []);

  /** Put every element where the clock says; `play` decides running or held. */
  const syncMedia = useCallback(
    (at: number, play: boolean) => {
      // Picture: only a playing clip holds the decoder.
      const shot = shotAt(timeline, at);
      const video = videoRef.current;
      if (video && shot && shot.source.kind === "clip" && play) {
        const rate = clipRateFor(shot);
        const want = shot.trimStartSeconds + (at - shot.startsAt) * rate;
        if (clipIdRef.current !== `${shot.flatIndex}:${shot.source.previewUrl}`) {
          clipIdRef.current = `${shot.flatIndex}:${shot.source.previewUrl}`;
          if (video.getAttribute("src") !== shot.source.previewUrl) {
            video.src = shot.source.previewUrl;
          }
          const start = () => {
            video.currentTime = want;
            video.playbackRate = rate;
            void video.play().catch(() => undefined);
          };
          if (video.readyState >= 1) start();
          else video.onloadedmetadata = start;
        } else if (video.readyState >= 1) {
          if (Math.abs(video.currentTime - want) > DRIFT_SECONDS) video.currentTime = want;
          if (video.paused) void video.play().catch(() => undefined);
        }
      } else if (clipIdRef.current !== null) {
        releaseVideo();
      }

      // Voice: silent through the lead-in and after it ends.
      const voice = voiceRef.current;
      if (voice) {
        const want = voiceTimeAt(timeline, at);
        if (want == null || !play) {
          if (!voice.paused) voice.pause();
          if (want != null && Math.abs(voice.currentTime - want) > 0.05) voice.currentTime = want;
          if (want == null && at < timeline.voiceStart && voice.currentTime !== 0) voice.currentTime = 0;
        } else {
          if (Math.abs(voice.currentTime - want) > DRIFT_SECONDS) voice.currentTime = want;
          if (voice.paused) void voice.play().catch(() => undefined);
        }
      }

      // Music: the whole clip, looped, dipping under the voice.
      const music = musicRef.current;
      if (music) {
        const length = Number.isFinite(music.duration) && music.duration > 0 ? music.duration : null;
        const want = length ? at % length : at;
        music.volume = voiceTimeAt(timeline, at) != null ? MUSIC_UNDER_VOICE : MUSIC_BED;
        if (!play) {
          if (!music.paused) music.pause();
          if (Math.abs(music.currentTime - want) > 0.05) music.currentTime = want;
        } else {
          if (Math.abs(music.currentTime - want) > DRIFT_SECONDS * 2) music.currentTime = want;
          if (music.paused) void music.play().catch(() => undefined);
        }
      }
    },
    [releaseVideo, timeline]
  );

  const stopClock = useCallback(() => {
    if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const pause = useCallback(() => {
    stopClock();
    setPlaying(false);
    voiceRef.current?.pause();
    musicRef.current?.pause();
    releaseVideo();
  }, [releaseVideo, stopClock]);

  const play = useCallback(
    (from?: number) => {
      stopClock();
      const start = from ?? (clock >= total - 0.05 ? 0 : clock);
      // WebViews only let an element start sound from inside a tap. The voice
      // may not be due for 0.6 s (the music lead-in), so unlock it now —
      // muted, and paused again at once if it is not its turn yet.
      for (const element of [voiceRef.current, musicRef.current]) {
        if (!element || !element.paused) continue;
        element.muted = true;
        void element
          .play()
          .then(() => {
            if (rafRef.current == null || (element === voiceRef.current && voiceTimeAt(timeline, start) == null)) {
              element.pause();
            }
          })
          .catch(() => undefined)
          .finally(() => {
            element.muted = false;
          });
      }
      clockRef.current = { startedAtWall: performance.now(), startedAtClock: start };
      setClock(start);
      setPlaying(true);
      syncMedia(start, true);
      const tick = () => {
        const now =
          clockRef.current.startedAtClock +
          (performance.now() - clockRef.current.startedAtWall) / 1000;
        if (now >= total) {
          setClock(total);
          pause();
          return;
        }
        setClock(now);
        syncMedia(now, true);
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    },
    [clock, pause, stopClock, syncMedia, timeline, total]
  );

  const seek = useCallback(
    (to: number) => {
      const at = Math.min(total, Math.max(0, to));
      if (playing) {
        play(at);
      } else {
        setClock(at);
        syncMedia(at, false);
      }
    },
    [play, playing, syncMedia, total]
  );

  // An edit (or a new voice, or a different track) changes the clock itself.
  useEffect(() => {
    pause();
    setClock((at) => Math.min(at, timeline.totalSeconds));
  }, [timeline, musicUrl, voiceUrl, pause]);

  useEffect(() => {
    setVoiceFailed(false);
    setMeasuredVoice(null);
  }, [voiceUrl]);

  // Leaving the Sound step must not leave anything playing.
  useEffect(() => pause, [pause]);

  // ── picture for the current clock ───────────────────────────────────────

  const placement = current
    ? framingStyle(current.source.aspect, document.ratio, current.frameZoom, current.focusX, current.focusY)
    : undefined;
  const into = current ? clock - current.startsAt : 0;
  const dissolveOpacity =
    current && current.dissolveSeconds > 0 && into < current.dissolveSeconds
      ? 0.25 + 0.75 * (into / current.dissolveSeconds)
      : 1;
  const imageTransform = current
    ? motionTransformAt(current.motion, into / current.durationSeconds)
    : undefined;
  const showVideo = playing && current?.source.kind === "clip";

  const pct = (seconds: number) => (total > 0 ? `${(seconds / total) * 100}%` : "0%");

  if (timeline.shots.length === 0) return null;

  return (
    <div className="studio-preview studio-sync-preview">
      <audio
        ref={voiceRef}
        src={voiceUrl}
        preload="auto"
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setMeasuredVoice(d);
        }}
        onError={() => setVoiceFailed(true)}
      />
      {musicUrl && <audio ref={musicRef} src={musicUrl} preload="auto" loop />}

      <div className="studio-preview-frame" style={{ aspectRatio: ratioValue(document.ratio) }}>
        <div style={{ position: "absolute", inset: 0, opacity: dissolveOpacity }}>
          <video
            ref={videoRef}
            muted
            playsInline
            preload="none"
            className="studio-preview-media"
            style={{ ...placement, display: showVideo ? "block" : "none" }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current?.source.posterUrl ?? undefined}
            alt=""
            className="studio-preview-media"
            style={{
              ...placement,
              transform: current?.source.kind === "image" ? imageTransform : undefined,
              transformOrigin: current ? `${current.focusX * 100}% ${current.focusY * 100}%` : undefined,
              display: current?.source.posterUrl && !showVideo ? "block" : "none",
            }}
          />
        </div>

        {inBlackTail && (
          <div className="studio-sync-black" aria-live="polite">
            {t("studio.sync.blackTail")}
          </div>
        )}

        <button
          type="button"
          className="studio-preview-play"
          aria-label={playing ? t("studio.sync.pause") : t("studio.sync.play")}
          onClick={() => (playing ? pause() : play())}
        >
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
        </button>
        <span className="studio-preview-badge">
          {current
            ? t("studio.preview.badge", {
                scene: current.sceneIndex + 1,
                shot: current.flatIndex + 1,
                total: timeline.shots.length,
              })
            : t("studio.sync.badgeBlack")}
        </span>
        {inLeadIn && <span className="studio-sync-chip">{t("studio.sync.leadIn")}</span>}
      </div>

      {/* The bar: picture row (shots, black tail) over the voice row, one clock. */}
      <div className="studio-sync-bar">
        <div className="studio-sync-row" aria-hidden>
          {timeline.shots.map((shot) => (
            <span
              key={`${shot.source.id}-${shot.flatIndex}`}
              className="studio-sync-shot"
              data-scene-start={shot.opensScene && shot.flatIndex > 0 ? "true" : undefined}
              data-current={current?.flatIndex === shot.flatIndex ? "true" : undefined}
              style={{ left: pct(shot.startsAt), width: pct(shot.durationSeconds) }}
            />
          ))}
          {timeline.blackTail && (
            <span
              className="studio-sync-tail"
              style={{
                left: pct(timeline.blackTail.start),
                width: pct(timeline.blackTail.end - timeline.blackTail.start),
              }}
            />
          )}
        </div>
        <div className="studio-sync-row studio-sync-row-voice" aria-hidden>
          {timeline.leadInSeconds > 0 && (
            <span className="studio-sync-lead" style={{ left: 0, width: pct(timeline.leadInSeconds) }} />
          )}
          {timeline.voiceEnd != null && (
            <span
              className="studio-sync-voice"
              style={{
                left: pct(timeline.voiceStart),
                width: pct(timeline.voiceEnd - timeline.voiceStart),
              }}
            />
          )}
        </div>
        <span className="studio-sync-head" style={{ left: pct(clock) }} aria-hidden />
        <input
          type="range"
          className="studio-sync-scrub"
          min={0}
          max={total}
          step={0.05}
          value={Math.min(clock, total)}
          aria-label={t("studio.sync.scrub")}
          onChange={(event) => seek(Number(event.target.value))}
        />
      </div>

      <p className="studio-counter" style={{ textAlign: "left", marginTop: 6 }}>
        {fmt(clock)}s / {fmt(total)}s · {t("studio.sync.lengthNote")}
      </p>
      <p className="studio-counter" style={{ textAlign: "left", marginTop: 2 }}>
        {t("studio.sync.legend", {
          picture: fmt(timeline.pictureSeconds),
          leadIn: fmt(timeline.leadInSeconds),
          voice: voiceLength != null ? fmt(voiceLength) : "–",
          tail: fmt(timeline.blackTail ? timeline.blackTail.end - timeline.blackTail.start : 0),
        })}
      </p>
      {timeline.transitions.some((tr) => tr.betweenScenes) && (
        <p className="studio-counter" style={{ textAlign: "left", marginTop: 2 }}>
          {t("studio.sync.transitionNote")}
        </p>
      )}
      {voiceFailed && (
        <p className="studio-note studio-note-danger" style={{ marginTop: 8 }}>
          {t("studio.sync.voiceFailed")}
        </p>
      )}
    </div>
  );
}
