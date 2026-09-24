"use client";

import type { ReactNode } from "react";

import type { EditorRatio, EditorSource } from "./editorState";
import { MediaThumb } from "./MediaThumb";

const RATIOS: { id: EditorRatio; label: string; note: string }[] = [
  { id: "9:16", label: "9:16", note: "Reels · Shorts · TikTok" },
  { id: "16:9", label: "16:9", note: "YouTube · Facebook" },
  { id: "1:1", label: "1:1", note: "Square" },
  { id: "4:5", label: "4:5", note: "Instagram feed" },
];

/**
 * Choosing the material and the canvas.
 *
 * The ratio is decided here rather than at render time because it changes what
 * every later decision looks like — a pan reads differently on a square canvas
 * than a portrait one, and choosing it last means reviewing the whole timeline
 * again.
 */
export function SourcePicker({
  sources,
  ratio,
  onAdd,
  onRemove,
  onRatioChange,
  disabled,
  locked = false,
  footer,
}: {
  sources: EditorSource[];
  ratio: EditorRatio;
  onAdd: (files: FileList | null) => void | Promise<void>;
  onRemove: (sourceId: string) => void;
  onRatioChange: (ratio: EditorRatio) => void;
  disabled: boolean;
  /**
   * The material has been submitted. The pipeline's storyboard counts items by
   * their position in the submitted list, so adding or removing one afterwards
   * would silently re-point every scene at the wrong picture.
   */
  locked?: boolean;
  /** Rendered directly under the media grid — the submit step lives here. */
  footer?: ReactNode;
}) {
  const clips = sources.filter((source) => source.kind === "clip").length;
  const photos = sources.length - clips;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">Main Video Shape</h2>
        <p className="studio-panel-hint">
          The shape the main video is made in. Your other channels&apos; shapes are made from it
          after you approve it.
        </p>
        <div className="studio-chip-row" role="group" aria-label="Output shape">
          {RATIOS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="studio-chip"
              aria-pressed={ratio === entry.id}
              disabled={disabled}
              onClick={() => onRatioChange(entry.id)}
            >
              <strong>{entry.label}</strong>
              <span style={{ color: "var(--s-text-faint)", fontWeight: 500 }}>{entry.note}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">Your footage</h2>
        <p className="studio-panel-hint">
          Originals stay on this phone. A clip&apos;s camera sound is removed — the narration
          is the approved speaking voice.
        </p>

        {locked ? (
          <p className="studio-note" style={{ marginBottom: 14 }}>
            Submitted. This material is fixed now, because the storyboard refers
            to it item by item.
          </p>
        ) : (
        <label className="studio-button studio-button-ghost" style={{ marginBottom: 14 }}>
          Add photos and clips
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4"
            multiple
            disabled={disabled}
            onChange={(event) => void onAdd(event.target.files)}
            // Visually hidden rather than display:none, so the label stays a
            // real, focusable control for a keyboard or a screen reader.
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
        </label>
        )}

        {sources.length === 0 ? (
          <p className="studio-empty">
            <span style={{ fontSize: 26 }} aria-hidden>
              ⬚
            </span>
            Nothing added yet
          </p>
        ) : (
          <>
            <p className="studio-panel-hint" style={{ marginBottom: 10 }}>
              {photos} photo{photos === 1 ? "" : "s"} · {clips} clip{clips === 1 ? "" : "s"}
            </p>
            <ul className="studio-media-grid">
              {sources.map((source) => (
                <li key={source.id} className="studio-media-tile">
                  <MediaThumb source={source} />
                  <span className="studio-media-badge">
                    {source.kind === "clip"
                      ? `${(source.durationSeconds ?? 0).toFixed(1)}s`
                      : "photo"}
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      className="studio-media-remove"
                      disabled={disabled}
                      aria-label={`Remove ${source.fileName}`}
                      onClick={() => onRemove(source.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {footer}
      </section>
    </>
  );
}
