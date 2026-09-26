"use client";

import type { ReactNode } from "react";

import type { EditorRatio, EditorSource } from "./editorState";
import { MediaThumb } from "./MediaThumb";
import { useStudioT } from "./studioI18n";

const RATIOS: EditorRatio[] = ["9:16", "16:9", "1:1", "4:5"];

/**
 * A picked photo or clip that is still being made ready, shown as its own tile
 * from the moment it is picked until it joins the material (or fails).
 */
export interface PendingMedia {
  id: string;
  fileName: string;
  kind: "image" | "clip";
  /**
   * waiting    → queued behind the item being prepared;
   * copying    → its bytes are going into the app's private storage (progress);
   * reading    → its length and thumbnail are being read;
   * converting → the phone is making a preview copy the screen can play;
   * ready      → has its thumbnail, joins the material when the batch ends;
   * failed     → could not be used; `error` says why.
   */
  state: "waiting" | "copying" | "reading" | "converting" | "ready" | "failed";
  /** 0..1 while copying, else null. */
  progress: number | null;
  posterUrl: string | null;
  durationSeconds?: number | null;
  error: string | null;
}

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
  pending = [],
  onDismissPending,
  onRatioChange,
  disabled,
  locked = false,
  footer,
}: {
  sources: EditorSource[];
  ratio: EditorRatio;
  onAdd: (files: FileList | null) => void | Promise<void>;
  onRemove: (sourceId: string) => void;
  /** Picked items still being prepared, or that failed. */
  pending?: PendingMedia[];
  onDismissPending?: (id: string) => void;
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
  const preparing = pending.some((item) => item.state !== "ready" && item.state !== "failed");
  // "Preparing 3 of 8": the item being worked on, counted in picking order.
  const finished = pending.filter((item) => item.state === "ready" || item.state === "failed").length;
  const current = Math.min(pending.length, finished + 1);

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
            disabled={disabled || preparing}
            onChange={(event) => {
              const input = event.target;
              void Promise.resolve(onAdd(input.files)).finally(() => {
                // Picking the same file again (after removing it) must fire.
                input.value = "";
              });
            }}
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

        {preparing && (
          <p className="studio-note studio-note-accent" role="status" aria-live="polite" style={{ marginBottom: 10 }}>
            <span className="studio-live-dot" aria-hidden />{" "}
            {t("studio.media.preparing", { current, total: pending.length })}
          </p>
        )}

        {sources.length === 0 && pending.length === 0 ? (
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
              {pending.map((item) => (
                <PendingTile
                  key={item.id}
                  item={item}
                  onDismiss={onDismissPending ? () => onDismissPending(item.id) : undefined}
                />
              ))}
            </ul>
          </>
        )}

        {footer}
      </section>
    </>
  );
}

/** One picked item on its way in: status, then its thumbnail, or its error. */
function PendingTile({ item, onDismiss }: { item: PendingMedia; onDismiss?: () => void }) {
  const t = useStudioT();
  const status =
    item.state === "waiting"
      ? t("studio.media.waiting")
      : item.state === "copying"
        ? t("studio.media.copying", { percent: Math.round((item.progress ?? 0) * 100) })
        : item.state === "reading"
          ? item.kind === "clip"
            ? t("studio.media.readingClip")
            : t("studio.media.readingPhoto")
          : item.state === "converting"
            ? t("studio.media.converting")
            : null;

  return (
    <li
      className="studio-media-tile studio-media-pending"
      data-state={item.state}
      aria-busy={item.state !== "ready" && item.state !== "failed"}
    >
      {item.state === "ready" && item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.posterUrl} alt={item.fileName} />
      ) : (
        <span className="studio-media-fallback studio-media-pending-body">
          {item.state === "failed" ? (
            <strong className="studio-media-pending-error" aria-hidden>
              !
            </strong>
          ) : item.state === "ready" ? null : (
            <span
              className={item.state === "waiting" ? "studio-spinner studio-spinner-idle" : "studio-spinner"}
              aria-hidden
            />
          )}
          <span className="studio-media-pending-name">{item.fileName}</span>
          {status && <span className="studio-media-pending-status">{status}</span>}
          {item.state === "failed" && item.error && (
            <span className="studio-media-pending-status" role="alert">
              {item.error}
            </span>
          )}
        </span>
      )}
      {item.state === "copying" && (
        <span className="studio-media-pending-bar" aria-hidden>
          <span style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }} />
        </span>
      )}
      {item.state === "ready" && (
        <span className="studio-media-badge">
          {item.kind === "clip"
            ? `${(item.durationSeconds ?? 0).toFixed(1)}s`
            : t("studio.source.photoBadge")}
        </span>
      )}
      {item.state === "failed" && onDismiss && (
        <button
          type="button"
          className="studio-media-remove"
          aria-label={t("studio.source.remove", { name: item.fileName })}
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </li>
  );
}
