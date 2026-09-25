"use client";

import type { ReactNode } from "react";

import type { EditorRatio, EditorSource } from "./editorState";
import { MediaThumb } from "./MediaThumb";
import { useStudioT } from "./studioI18n";

const RATIOS: EditorRatio[] = ["9:16", "16:9", "1:1", "4:5"];

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
  const t = useStudioT();
  const clips = sources.filter((source) => source.kind === "clip").length;
  const photos = sources.length - clips;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.source.shapeTitle")}</h2>
        <p className="studio-panel-hint">{t("studio.source.shapeHint")}</p>
        <div className="studio-chip-row" role="group" aria-label={t("studio.source.shapeAria")}>
          {RATIOS.map((entry) => (
            <button
              key={entry}
              type="button"
              className="studio-chip"
              aria-pressed={ratio === entry}
              disabled={disabled}
              onClick={() => onRatioChange(entry)}
            >
              <strong>{entry}</strong>
              <span style={{ color: "var(--s-text-faint)", fontWeight: 500 }}>
                {t(`studio.source.ratio.${entry}`)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.source.footageTitle")}</h2>
        <p className="studio-panel-hint">{t("studio.source.footageHint")}</p>

        {locked ? (
          <p className="studio-note" style={{ marginBottom: 14 }}>
            {t("studio.source.locked")}
          </p>
        ) : (
        <label className="studio-button studio-button-ghost" style={{ marginBottom: 14 }}>
          {t("studio.source.add")}
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
            {t("studio.source.empty")}
          </p>
        ) : (
          <>
            <p className="studio-panel-hint" style={{ marginBottom: 10 }}>
              {t("studio.source.counts", { photos, clips })}
            </p>
            <ul className="studio-media-grid">
              {sources.map((source) => (
                <li key={source.id} className="studio-media-tile">
                  <MediaThumb source={source} />
                  <span className="studio-media-badge">
                    {source.kind === "clip"
                      ? `${(source.durationSeconds ?? 0).toFixed(1)}s`
                      : t("studio.source.photoBadge")}
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      className="studio-media-remove"
                      disabled={disabled}
                      aria-label={t("studio.source.remove", { name: source.fileName })}
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
