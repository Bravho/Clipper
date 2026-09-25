"use client";

import { useEffect, useRef, useState } from "react";

import type { MontageTransition, MotionPreset } from "@/config/montage";
import { ClipTrimBar, type ClipTrimLabels } from "@/features/requests/components/ClipTrimBar";
import { aspectOfRatio, fillCoverage, framePlacement, subjectCentre } from "@/lib/mobile/shotFraming";
import {
  findSource,
  scenesPlaySeconds,
  shotFrameZoom,
  shotPlaySeconds,
  type EditorDocument,
  type EditorShot,
  type EditorSource,
} from "./editorState";
import { MediaThumb } from "./MediaThumb";
import { framingStyle, StoryboardPreview } from "./StoryboardPreview";
import { useStudioT, type StudioT } from "./studioI18n";

const motionLabel = (t: StudioT, motion: MotionPreset) => t(`studio.motion.${motion}`);
const transitionLabel = (t: StudioT, transition: MontageTransition) =>
  t(`studio.transition.${transition}`);

/** The request page's trim bar, in the studio's language. */
function trimLabels(t: StudioT): ClipTrimLabels {
  return {
    clip: t("studio.trim.clip"),
    playFailed: t("studio.trim.playFailed"),
    loadFailed: t("studio.trim.loadFailed"),
    playClip: t("studio.trim.playClip"),
    pauseClip: t("studio.trim.pauseClip"),
    loading: (percent) => t("studio.trim.loading", { percent }),
    loadingClip: t("studio.trim.loadingClip"),
    startHandle: t("studio.trim.startHandle"),
    endHandle: t("studio.trim.endHandle"),
    pause: t("studio.trim.pause"),
    playWindow: t("studio.trim.playWindow"),
    windowPrefix: (start, end) => t("studio.trim.windowPrefix", { start, end }),
    lengthUnit: t("studio.trim.lengthUnit"),
  };
}

const SEGMENT_COLORS = ["var(--s-accent)", "#60a5fa", "#a78bfa", "#34d399", "#f472b6", "#fbbf24"];

export interface StoryboardApproval {
  label: string;
  hint: string;
  disabled: boolean;
  busy: boolean;
}

/**
 * The storyboard: the plan the pipeline wrote, made into an edit.
 *
 * Formerly the Timeline. It is where the pipeline's storyboard lands after the
 * media is submitted, and where it becomes the video: scene order, what each
 * scene shows, which material it uses, and — shot by shot — how long it holds
 * the screen and what part of it plays.
 *
 * TRIMMING IS DRAGGED, NOT TYPED. A clip gets the request page's own trim bar:
 * a filmstrip, two handles, and a looping preview of exactly the window kept.
 * The window IS the shot's length, so dragging a handle is how a shot is made
 * shorter or longer. A photo gets a slider for its time on screen and its
 * camera move, and the preview at the top plays the whole storyboard so the
 * rhythm can be judged, not just each piece.
 *
 * THE LENGTH IS CHECKED AGAINST WHAT MATTERS. Before there is a voice that is
 * the brief's target length; once the voice exists it is the voice plus the
 * intro and ending, the same rule the approval gate enforces — so "Approve"
 * never fails on the server for a reason the screen did not show.
 */
export function SceneList({
  document,
  transitions,
  motions,
  onPatchShot,
  onAddScene,
  onToggleSource,
  onSceneTransition,
  onMoveScene,
  onRemoveScene,
  onSceneSummary,
  onFit,
  targetSeconds,
  requiredSeconds,
  planning,
  planError,
  lockedNote = null,
  approval,
  onApprove,
  disabled,
}: {
  document: EditorDocument;
  transitions: MontageTransition[];
  motions: MotionPreset[];
  onPatchShot: (sceneId: string, shotId: string, change: Partial<EditorShot>) => void;
  onAddScene: () => void;
  onToggleSource: (sceneId: string, sourceId: string) => void;
  onSceneTransition: (sceneId: string, transition: MontageTransition) => void;
  onMoveScene: (sceneIndex: number, by: -1 | 1) => void;
  onRemoveScene: (sceneId: string) => void;
  onSceneSummary: (sceneId: string, summary: string) => void;
  /** Share `seconds` out across the shots. */
  onFit: (seconds: number) => void;
  /** The brief's length. */
  targetSeconds: number;
  /** Once the voice exists: the least the picture must run to cover it. */
  requiredSeconds: number | null;
  planning: boolean;
  planError: string | null;
  lockedNote?: string | null;
  /** The button at the bottom; null when there is nothing to approve here. */
  approval: StoryboardApproval | null;
  onApprove: () => void;
  disabled: boolean;
}) {
  // FOLLOW A MOVED SCENE. Moving a scene swaps it with its neighbour, so the
  // scene under the finger is suddenly a different one — and a second tap on
  // the same spot moved THAT scene, which is how the order ended up not what
  // was intended. After a move, the moved scene is scrolled back to where its
  // buttons are, and briefly highlighted.
  const t = useStudioT();
  const sceneRefs = useRef(new Map<string, HTMLElement>());
  const [movedSceneId, setMovedSceneId] = useState<string | null>(null);
  const moveScene = (sceneIndex: number, by: -1 | 1) => {
    const id = document.scenes[sceneIndex]?.id;
    onMoveScene(sceneIndex, by);
    if (id) setMovedSceneId(id);
  };
  useEffect(() => {
    if (!movedSceneId) return;
    const element = sceneRefs.current.get(movedSceneId);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
    const timer = window.setTimeout(() => setMovedSceneId(null), 1_200);
    return () => window.clearTimeout(timer);
  }, [movedSceneId, document.scenes]);

  if (planning) {
    return (
      <section className="studio-panel">
        <h2 className="studio-panel-title">
          <span className="studio-eyebrow" style={{ color: "var(--s-accent-text)" }}>
            <span className="studio-live-dot" aria-hidden />
            {t("studio.scenes.planning")}
          </span>
        </h2>
        <p className="studio-panel-hint">{t("studio.scenes.planningHint")}</p>
      </section>
    );
  }

  if (document.sources.length === 0) {
    return (
      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.scenes.title")}</h2>
        {planError && <p className="studio-note studio-note-danger">{planError}</p>}
        <p className="studio-empty">{t("studio.scenes.addFirst")}</p>
      </section>
    );
  }

  const total = scenesPlaySeconds(document.scenes);
  const needed = requiredSeconds ?? targetSeconds;
  const short = requiredSeconds != null ? total + 1 / 30 < requiredSeconds : false;
  const offTarget = requiredSeconds == null && Math.abs(total - targetSeconds) > 0.25;

  let segment = -1;

  return (
    <section className="studio-panel">
      <h2 className="studio-panel-title">{t("studio.scenes.title")}</h2>
      {planError && (
        <p className="studio-note studio-note-danger" style={{ marginBottom: 12 }}>
          {planError}
        </p>
      )}
      {lockedNote && (
        <p className="studio-note studio-note-accent" style={{ marginBottom: 12 }}>
          {lockedNote}
        </p>
      )}

      <StoryboardPreview document={document} jump={null} />

      <div className="studio-fit" role="status">
        <span>
          <strong>{total.toFixed(1)}s</strong>{" "}
          {requiredSeconds != null
            ? t("studio.scenes.voiceNeeds", { seconds: requiredSeconds.toFixed(1) })
            : t("studio.scenes.target", { seconds: targetSeconds })}
        </span>
        {(short || offTarget) && !disabled && (
          <button
            type="button"
            className="studio-button studio-button-ghost"
            onClick={() => onFit(Math.ceil(needed * 10) / 10)}
          >
            {requiredSeconds != null
              ? t("studio.scenes.fitVoice")
              : t("studio.scenes.fitTarget", { seconds: targetSeconds })}
          </button>
        )}
      </div>
      {short && (
        <p className="studio-note studio-note-warning" style={{ marginBottom: 8 }}>
          {t("studio.scenes.short", { seconds: (requiredSeconds! - total).toFixed(1) })}
        </p>
      )}

      {total > 0 && (
        <div className="studio-duration-bar" role="img" aria-label={t("studio.scenes.barAria")}>
          {document.scenes.flatMap((scene) =>
            scene.shots.map((shot) => {
              segment += 1;
              return (
                <span
                  key={shot.id}
                  className="studio-duration-seg"
                  style={{
                    width: `${(shotPlaySeconds(shot) / total) * 100}%`,
                    background: SEGMENT_COLORS[segment % SEGMENT_COLORS.length],
                  }}
                />
              );
            })
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {document.scenes.map((scene, sceneIndex) => (
          <article
            key={scene.id}
            className="studio-scene"
            data-moved={movedSceneId === scene.id ? "true" : undefined}
            ref={(element) => {
              if (element) sceneRefs.current.set(scene.id, element);
              else sceneRefs.current.delete(scene.id);
            }}
          >
            <header className="studio-scene-head" style={{ flexWrap: "wrap" }}>
              <h3 className="studio-scene-name">
                {t("studio.scenes.scene", { number: sceneIndex + 1 })}
              </h3>
              {sceneIndex === 0 ? (
                <span style={{ fontSize: 12, color: "var(--s-text-faint)" }}>
                  {t("studio.scenes.opens")}
                </span>
              ) : (
                <label style={{ fontSize: 12, color: "var(--s-text-muted)" }}>
                  {t("studio.scenes.entersWith")}{" "}
                  <select
                    className="studio-select"
                    style={{ minHeight: 36, width: "auto", display: "inline-block", fontSize: 14 }}
                    value={scene.transitionIn}
                    disabled={disabled}
                    onChange={(event) =>
                      onSceneTransition(scene.id, event.target.value as MontageTransition)
                    }
                  >
                    {transitions.map((transition) => (
                      <option key={transition} value={transition}>
                        {transitionLabel(t, transition)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="studio-scene-move"
                  aria-label={t("studio.scenes.moveEarlier", { number: sceneIndex + 1 })}
                  disabled={disabled || sceneIndex === 0}
                  onClick={() => moveScene(sceneIndex, -1)}
                >
                  {t("studio.scenes.up")}
                </button>
                <button
                  type="button"
                  className="studio-scene-move"
                  aria-label={t("studio.scenes.moveLater", { number: sceneIndex + 1 })}
                  disabled={disabled || sceneIndex === document.scenes.length - 1}
                  onClick={() => moveScene(sceneIndex, 1)}
                >
                  {t("studio.scenes.down")}
                </button>
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={t("studio.scenes.remove", { number: sceneIndex + 1 })}
                  style={{ color: "var(--s-danger)" }}
                  disabled={disabled}
                  onClick={() => onRemoveScene(scene.id)}
                >
                  ×
                </button>
              </div>
            </header>

            <label style={{ display: "block", padding: "10px 12px 0" }}>
              <span className="studio-label">{t("studio.scenes.shows")}</span>
              <textarea
                className="studio-textarea"
                style={{ minHeight: 64 }}
                value={scene.summary}
                disabled={disabled}
                onChange={(event) => onSceneSummary(scene.id, event.target.value)}
              />
            </label>

            {scene.shots.length === 0 && (
              <p className="studio-empty" style={{ margin: 14, padding: 20 }}>
                {t("studio.scenes.pickBelow")}
              </p>
            )}

            {scene.shots.map((shot) => {
              const source = findSource(document, shot.sourceId);
              if (!source) return null;
              const isClip = source.kind === "clip";
              const window =
                shot.trimEndSeconds != null ? shot.trimEndSeconds - shot.trimStartSeconds : null;
              const slowed = isClip && window != null && window > 0 && shot.durationSeconds > window + 0.05;

              return (
                <div key={shot.id} className="studio-shot">
                  <div className="studio-shot-head">
                    <div className="studio-shot-thumb">
                      <MediaThumb source={source} />
                    </div>
                    <div className="studio-shot-main">
                      <div className="studio-shot-name">
                        {source.fileName}
                      </div>
                      <div className="studio-shot-meta">
                        {isClip
                          ? t("studio.scenes.clipMeta", {
                              from: shot.trimStartSeconds.toFixed(1),
                              to: (
                                shot.trimEndSeconds ?? shot.trimStartSeconds + shot.durationSeconds
                              ).toFixed(1),
                              seconds: shotPlaySeconds(shot).toFixed(1),
                            })
                          : t("studio.scenes.photoMeta", {
                              motion: motionLabel(t, shot.motion),
                              seconds: shot.durationSeconds.toFixed(1),
                            })}
                      </div>
                    </div>
                  </div>

                  {isClip ? (
                    <div className="studio-trim" style={disabled ? { pointerEvents: "none", opacity: 0.6 } : undefined}>
                      <ClipTrimBar
                        key={`${source.id}-${shot.id}`}
                        url={source.previewUrl}
                        posterUrl={source.posterUrl}
                        sourceDurationSeconds={source.durationSeconds}
                        trimStartSeconds={shot.trimStartSeconds}
                        trimEndSeconds={shot.trimEndSeconds ?? undefined}
                        aspectRatio={document.ratio}
                        labels={trimLabels(t)}
                        onChange={({ start, end }) => {
                          // The kept window is the shot: drag a handle and the
                          // shot is that much shorter or longer on screen.
                          const round = (value: number) => Math.round(value * 100) / 100;
                          onPatchShot(scene.id, shot.id, {
                            trimStartSeconds: round(start),
                            trimEndSeconds: round(end),
                            durationSeconds: Math.round((end - start) * 10) / 10,
                          });
                        }}
                      />
                      {slowed && (
                        <p className="studio-shot-meta" style={{ marginTop: 8 }}>
                          {t("studio.scenes.slowed", {
                            screen: shot.durationSeconds.toFixed(1),
                            footage: window!.toFixed(1),
                          })}
                        </p>
                      )}
                      <FramingControl
                        source={source}
                        shot={shot}
                        ratio={document.ratio}
                        disabled={disabled}
                        onChange={(change) => onPatchShot(scene.id, shot.id, change)}
                      />
                    </div>
                  ) : (
                    <div className="studio-shot-controls">
                      <label style={{ gridColumn: "1 / -1" }}>
                        <span className="studio-label">
                          {t("studio.scenes.onScreen", { seconds: shot.durationSeconds.toFixed(1) })}
                        </span>
                        <input
                          className="studio-range"
                          type="range"
                          min="0.5"
                          max="10"
                          step="0.1"
                          value={shot.durationSeconds}
                          disabled={disabled}
                          onChange={(event) =>
                            onPatchShot(scene.id, shot.id, {
                              durationSeconds: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        <span className="studio-label">{t("studio.scenes.cameraMove")}</span>
                        <select
                          className="studio-select"
                          value={shot.motion}
                          disabled={disabled}
                          onChange={(event) =>
                            onPatchShot(scene.id, shot.id, {
                              motion: event.target.value as MotionPreset,
                            })
                          }
                        >
                          {motions.map((motion) => (
                            <option key={motion} value={motion}>
                              {motionLabel(t, motion)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <FramingControl
                          source={source}
                          shot={shot}
                          ratio={document.ratio}
                          disabled={disabled}
                          onChange={(change) => onPatchShot(scene.id, shot.id, change)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ padding: 12 }}>
              <span className="studio-label">{t("studio.scenes.pickTitle")}</span>
              <p className="studio-shot-meta" style={{ margin: "0 0 8px" }}>
                {t("studio.scenes.pickHint")}
              </p>
              <ul className="studio-pick-grid">
                {document.sources.map((source) => {
                  const chosen = scene.shots.some((shot) => shot.sourceId === source.id);
                  return (
                    <li key={source.id}>
                      <button
                        type="button"
                        className="studio-pick"
                        aria-pressed={chosen}
                        aria-label={t(chosen ? "studio.scenes.clearFrom" : "studio.scenes.useFor", {
                          name: source.fileName,
                          number: sceneIndex + 1,
                        })}
                        disabled={disabled}
                        onClick={() => onToggleSource(scene.id, source.id)}
                      >
                        <MediaThumb source={source} />
                        {chosen && (
                          <span className="studio-pick-tick" aria-hidden>
                            ✓
                          </span>
                        )}
                        <span className="studio-pick-kind" aria-hidden>
                          {source.kind === "clip" ? t("studio.scenes.clip") : t("studio.scenes.photo")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </article>
        ))}
      </div>

      {!disabled && (
        <button
          type="button"
          className="studio-button studio-button-ghost"
          style={{ marginTop: 12 }}
          onClick={onAddScene}
        >
          {t("studio.scenes.addScene")}
        </button>
      )}

      {approval && (
        <div className="studio-approve">
          <button
            type="button"
            className="studio-button studio-button-primary"
            disabled={approval.disabled || approval.busy}
            onClick={onApprove}
          >
            {approval.busy ? t("studio.scenes.working") : approval.label}
          </button>
          <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
            {approval.hint}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Framing: how much of the photo or clip is in the video, and which part.
 *
 * When the picture's shape is not the video's — a tall phone clip in a wide
 * YouTube or Facebook video is the usual case — "fill the frame" cuts most of
 * it away. This shows the shot exactly as it will be framed, with a zoom from
 * "whole picture" to "fill the frame" and a tap target for the main subject.
 * Left alone, it is framed automatically: zoomed out just enough to keep what
 * the AI found as the subject (or most of the picture when it found nothing).
 */
function FramingControl({
  source,
  shot,
  ratio,
  disabled,
  onChange,
}: {
  source: EditorSource;
  shot: EditorShot;
  ratio: string;
  disabled: boolean;
  onChange: (change: Partial<EditorShot>) => void;
}) {
  const t = useStudioT();
  const zoom = shotFrameZoom(shot, source, ratio);
  const automatic = shot.frameZoom == null;
  const sameShape =
    source.aspect != null && fillCoverage(source.aspect, aspectOfRatio(ratio)) >= 0.97;
  const imageUrl = source.posterUrl ?? (source.kind === "image" ? source.previewUrl : null);
  const [w, h] = ratio.split(":");

  return (
    <div className="studio-framing">
      <span className="studio-label">{t("studio.framing.title", { ratio })}</span>
      {imageUrl && (
        <button
          type="button"
          className="studio-framing-frame"
          style={{ aspectRatio: `${w} / ${h}` }}
          disabled={disabled}
          aria-label={t("studio.framing.aria")}
          onClick={(event) => {
            // Tap = "keep THIS in view": turn the tap on the framed picture
            // back into a point on the whole picture and make it the focus.
            if (!source.aspect) return;
            const box = event.currentTarget.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return;
            const canvasAspect = aspectOfRatio(ratio);
            const placed = framePlacement(
              { width: source.aspect, height: 1 },
              { width: canvasAspect, height: 1 },
              zoom,
              shot.focusX,
              shot.focusY
            );
            const cx = ((event.clientX - box.left) / box.width) * canvasAspect;
            const cy = (event.clientY - box.top) / box.height;
            const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
            onChange({
              focusX: round((cx - placed.x) / placed.width),
              focusY: round((cy - placed.y) / placed.height),
            });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local poster frame */}
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            style={framingStyle(source.aspect, ratio, zoom, shot.focusX, shot.focusY)}
          />
        </button>
      )}
      <p className="studio-shot-meta" style={{ margin: 0 }}>
        {t("studio.framing.hint")}
      </p>
      {sameShape ? (
        <p className="studio-shot-meta" style={{ margin: "6px 0 0" }}>
          {t("studio.framing.sameShape")}
        </p>
      ) : (
        <>
          <label className="studio-framing-zoom">
            <span className="studio-shot-meta">
              {zoom <= 0.02
                ? t("studio.framing.whole")
                : zoom >= 0.98
                  ? t("studio.framing.fills")
                  : t("studio.framing.zoom", { percent: Math.round(zoom * 100) })}
              {automatic ? t("studio.framing.auto") : ""}
            </span>
            <span className="studio-framing-ends">
              <span>{t("studio.framing.wholeShort")}</span>
              <input
                className="studio-range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={zoom}
                disabled={disabled || source.aspect == null}
                aria-label={t("studio.framing.zoomAria")}
                onChange={(event) => onChange({ frameZoom: Number(event.target.value) })}
              />
              <span>{t("studio.framing.fillShort")}</span>
            </span>
          </label>
          {!automatic && (
            <button
              type="button"
              className="studio-button studio-button-ghost"
              style={{ marginTop: 6, width: "auto", minHeight: 36, padding: "6px 12px", fontSize: 13 }}
              disabled={disabled}
              onClick={() =>
                onChange({
                  frameZoom: null,
                  ...(source.subject ? subjectCentre(source.subject) : {}),
                })
              }
            >
              {source.subject ? t("studio.framing.autoAi") : t("studio.framing.autoPlain")}
            </button>
          )}
        </>
      )}
      {(Math.abs(shot.focusX - 0.5) > 0.01 || Math.abs(shot.focusY - 0.5) > 0.01) && (
        <button
          type="button"
          className="studio-button studio-button-ghost"
          style={{ width: "auto", minHeight: 36, padding: "6px 12px", fontSize: 13 }}
          disabled={disabled}
          onClick={() => onChange({ focusX: 0.5, focusY: 0.5 })}
        >
          {t("studio.framing.centre")}
        </button>
      )}
    </div>
  );
}
