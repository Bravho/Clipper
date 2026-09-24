"use client";

import { useState } from "react";

import type { MontageTransition, MotionPreset } from "@/config/montage";
import { CLIP_TRIM_LABELS_EN, ClipTrimBar } from "@/features/requests/components/ClipTrimBar";
import { aspectOfRatio, fillCoverage, subjectCentre } from "@/lib/mobile/shotFraming";
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

const MOTION_LABELS: Record<MotionPreset, string> = {
  ken_burns_in: "Zoom in",
  ken_burns_out: "Zoom out",
  pan_left: "Pan left",
  pan_right: "Pan right",
  static: "Hold",
};

const TRANSITION_LABELS: Record<MontageTransition, string> = {
  cut: "Cut",
  fade: "Dissolve",
  slide: "Slide",
  zoom: "Zoom",
};

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
  onMoveShot,
  onRemoveShot,
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
  onMoveShot: (sceneId: string, index: number, by: -1 | 1) => void;
  onRemoveShot: (sceneId: string, shotId: string) => void;
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
  const [jump, setJump] = useState<{ index: number; nonce: number } | null>(null);

  if (planning) {
    return (
      <section className="studio-panel">
        <h2 className="studio-panel-title">
          <span className="studio-eyebrow" style={{ color: "var(--s-accent)" }}>
            <span className="studio-live-dot" aria-hidden />
            Planning your storyboard
          </span>
        </h2>
        <p className="studio-panel-hint">
          RClipper is reading your brief and a small preview of each item, and writing the
          storyboard and the speaking script. This usually takes under a minute; you can stay
          here or come back.
        </p>
      </section>
    );
  }

  if (document.sources.length === 0) {
    return (
      <section className="studio-panel">
        <h2 className="studio-panel-title">Storyboard</h2>
        {planError && <p className="studio-note studio-note-danger">{planError}</p>}
        <p className="studio-empty">Add photos or clips first</p>
      </section>
    );
  }

  const total = scenesPlaySeconds(document.scenes);
  const needed = requiredSeconds ?? targetSeconds;
  const short = requiredSeconds != null ? total + 1 / 30 < requiredSeconds : false;
  const offTarget = requiredSeconds == null && Math.abs(total - targetSeconds) > 0.25;

  let flat = -1;
  let segment = -1;

  return (
    <section className="studio-panel">
      <h2 className="studio-panel-title">Storyboard</h2>
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

      <StoryboardPreview document={document} jump={jump} />

      <div className="studio-fit" role="status">
        <span>
          <strong>{total.toFixed(1)}s</strong>{" "}
          {requiredSeconds != null
            ? `· the voice needs at least ${requiredSeconds.toFixed(1)}s`
            : `· target ${targetSeconds}s`}
        </span>
        {(short || offTarget) && !disabled && (
          <button
            type="button"
            className="studio-button studio-button-ghost"
            onClick={() => onFit(Math.ceil(needed * 10) / 10)}
          >
            {requiredSeconds != null ? "Fit to the voice" : `Fit to ${targetSeconds}s`}
          </button>
        )}
      </div>
      {short && (
        <p className="studio-note studio-note-warning" style={{ marginBottom: 8 }}>
          The picture is {(requiredSeconds! - total).toFixed(1)}s shorter than the voice. Lengthen
          some shots or fit it, or the ending would be black.
        </p>
      )}

      {total > 0 && (
        <div className="studio-duration-bar" role="img" aria-label="Each shot's share of the video">
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
          <article key={scene.id} className="studio-scene">
            <header className="studio-scene-head" style={{ flexWrap: "wrap" }}>
              <h3 className="studio-scene-name">Scene {sceneIndex + 1}</h3>
              {sceneIndex === 0 ? (
                <span style={{ fontSize: 12, color: "var(--s-text-faint)" }}>Opens the video</span>
              ) : (
                <label style={{ fontSize: 12, color: "var(--s-text-muted)" }}>
                  Enters with{" "}
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
                        {TRANSITION_LABELS[transition]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={`Move scene ${sceneIndex + 1} earlier`}
                  disabled={disabled || sceneIndex === 0}
                  onClick={() => onMoveScene(sceneIndex, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={`Move scene ${sceneIndex + 1} later`}
                  disabled={disabled || sceneIndex === document.scenes.length - 1}
                  onClick={() => onMoveScene(sceneIndex, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label={`Remove scene ${sceneIndex + 1}`}
                  style={{ color: "var(--s-danger)" }}
                  disabled={disabled}
                  onClick={() => onRemoveScene(scene.id)}
                >
                  ×
                </button>
              </div>
            </header>

            <label style={{ display: "block", padding: "10px 12px 0" }}>
              <span className="studio-label">What this scene shows</span>
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
                Pick material for this scene below
              </p>
            )}

            {scene.shots.map((shot, shotIndex) => {
              const source = findSource(document, shot.sourceId);
              if (!source) return null;
              flat += 1;
              const at = flat;
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
                        {shotIndex + 1}. {source.fileName}
                      </div>
                      <div className="studio-shot-meta">
                        {isClip
                          ? `Clip · ${(source.durationSeconds ?? 0).toFixed(1)}s long · on screen ${shotPlaySeconds(shot).toFixed(1)}s`
                          : `Photo · on screen ${shot.durationSeconds.toFixed(1)}s`}
                      </div>
                    </div>
                  </div>

                  <div className="studio-shot-tools">
                    <button
                      type="button"
                      className="studio-button studio-button-ghost"
                      onClick={() => setJump({ index: at, nonce: Date.now() })}
                    >
                      ▶ Play from here
                    </button>
                    <button
                      type="button"
                      className="studio-icon-button"
                      aria-label="Move shot earlier"
                      disabled={disabled || shotIndex === 0}
                      onClick={() => onMoveShot(scene.id, shotIndex, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="studio-icon-button"
                      aria-label="Move shot later"
                      disabled={disabled || shotIndex === scene.shots.length - 1}
                      onClick={() => onMoveShot(scene.id, shotIndex, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="studio-icon-button"
                      aria-label="Remove shot"
                      style={{ color: "var(--s-danger)" }}
                      disabled={disabled}
                      onClick={() => onRemoveShot(scene.id, shot.id)}
                    >
                      ×
                    </button>
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
                        labels={CLIP_TRIM_LABELS_EN}
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
                          Fitted to {shot.durationSeconds.toFixed(1)}s on screen, so this{" "}
                          {window!.toFixed(1)}s of footage plays slightly slower.
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
                          On screen — {shot.durationSeconds.toFixed(1)}s
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
                        <span className="studio-label">Camera move</span>
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
                              {MOTION_LABELS[motion]}
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
              <span className="studio-label">Material in this scene</span>
              <ul className="studio-pick-grid">
                {document.sources.map((source) => {
                  const chosen = scene.shots.some((shot) => shot.sourceId === source.id);
                  return (
                    <li key={source.id}>
                      <button
                        type="button"
                        className="studio-pick"
                        aria-pressed={chosen}
                        aria-label={`${chosen ? "Stop using" : "Use"} ${source.fileName} in scene ${sceneIndex + 1}`}
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
                          {source.kind === "clip" ? "Clip" : "Photo"}
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
          Add a scene
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
            {approval.busy ? "Working…" : approval.label}
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
  const zoom = shotFrameZoom(shot, source, ratio);
  const automatic = shot.frameZoom == null;
  const sameShape =
    source.aspect != null && fillCoverage(source.aspect, aspectOfRatio(ratio)) >= 0.97;
  const imageUrl = source.posterUrl ?? (source.kind === "image" ? source.previewUrl : null);
  const [w, h] = ratio.split(":");

  return (
    <div className="studio-framing">
      <span className="studio-label">Framing in the {ratio} video</span>
      {imageUrl && (
        <div
          className="studio-framing-frame"
          style={{ aspectRatio: `${w} / ${h}` }}
          aria-label="How this shot will be framed"
          role="img"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local poster frame */}
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            style={framingStyle(source.aspect, ratio, zoom, shot.focusX, shot.focusY)}
          />
        </div>
      )}
      {sameShape ? (
        <p className="studio-shot-meta" style={{ margin: "6px 0 0" }}>
          Same shape as the video — nothing is cut off.
        </p>
      ) : (
        <>
          <label className="studio-framing-zoom">
            <span className="studio-shot-meta">
              {zoom <= 0.02
                ? "Whole picture"
                : zoom >= 0.98
                  ? "Fills the frame"
                  : `Zoom ${Math.round(zoom * 100)}%`}
              {automatic ? " · set automatically" : ""}
            </span>
            <span className="studio-framing-ends">
              <span>Whole</span>
              <input
                className="studio-range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={zoom}
                disabled={disabled || source.aspect == null}
                aria-label="Zoom from the whole picture to filling the frame"
                onChange={(event) => onChange({ frameZoom: Number(event.target.value) })}
              />
              <span>Fill</span>
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
              {source.subject ? "Frame it automatically (AI)" : "Frame it automatically"}
            </button>
          )}
        </>
      )}
      <SubjectPicker
        imageUrl={imageUrl}
        focusX={shot.focusX}
        focusY={shot.focusY}
        disabled={disabled}
        onChange={(focusX, focusY) => onChange({ focusX, focusY })}
      />
    </div>
  );
}

/**
 * "Main subject": tap the photo where the thing that matters is.
 *
 * The camera move zooms and pans, and the crop to the video's shape cuts the
 * edges off — this is the point both keep in view. It replaces two sliders
 * labelled "across / down", which described the same thing as a pair of
 * percentages nobody could picture.
 */
function SubjectPicker({
  imageUrl,
  focusX,
  focusY,
  disabled,
  onChange,
}: {
  imageUrl: string | null;
  focusX: number;
  focusY: number;
  disabled: boolean;
  onChange: (focusX: number, focusY: number) => void;
}) {
  const centred = Math.abs(focusX - 0.5) < 0.01 && Math.abs(focusY - 0.5) < 0.01;
  const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <span className="studio-label">Main subject</span>
      <p className="studio-shot-meta" style={{ margin: "0 0 8px" }}>
        Tap the picture on the most important part — the product, the dish, the sign. The zoom
        and the crop keep it in view.
      </p>
      {imageUrl ? (
        <button
          type="button"
          className="studio-subject"
          disabled={disabled}
          aria-label="Tap where the main subject is"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return;
            onChange(
              round((event.clientX - box.left) / box.width),
              round((event.clientY - box.top) / box.height)
            );
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local poster frame */}
          <img src={imageUrl} alt="" draggable={false} />
          <span
            className="studio-subject-marker"
            aria-hidden
            style={{ left: `${focusX * 100}%`, top: `${focusY * 100}%` }}
          />
        </button>
      ) : null}
      {!centred && (
        <button
          type="button"
          className="studio-button studio-button-ghost"
          style={{ marginTop: 8, width: "auto", minHeight: 36, padding: "6px 12px", fontSize: 13 }}
          disabled={disabled}
          onClick={() => onChange(0.5, 0.5)}
        >
          Back to the centre
        </button>
      )}
    </div>
  );
}
