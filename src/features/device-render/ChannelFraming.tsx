"use client";

import { useState } from "react";

import { aspectOfRatio, fillCoverage } from "@/lib/mobile/shotFraming";
import {
  findSource,
  shotShapeFraming,
  type EditorDocument,
  type EditorRatio,
  type EditorShot,
} from "./editorState";
import { FramingControl } from "./SceneList";
import { framingStyle, previewBoxStyle } from "./StoryboardPreview";
import { useStudioT } from "./studioI18n";

export type ChannelFramingStatus = "idle" | "checking" | "done" | "failed";

/**
 * Channels: how every scene will be framed in each extra shape, BEFORE the
 * phone spends minutes rendering it.
 *
 * Each shot is framed for each shape on its own — kept whole and centred on
 * what the AI saw in that shot (see `frameForShape`) — instead of reusing the
 * main video's crop, which cut products off in wide videos. Tapping a shot
 * opens the same framing control as the storyboard, for that shape only.
 */
export function ChannelFraming({
  document,
  ratios,
  status,
  thumbnails,
  disabled,
  onChange,
}: {
  document: EditorDocument;
  /** The shapes about to be made. */
  ratios: string[];
  status: ChannelFramingStatus;
  /** A frame from inside each shot, by shot id (falls back to the poster). */
  thumbnails: Record<string, string>;
  disabled: boolean;
  /** Set the person's framing of a shot in a shape; null = automatic again. */
  onChange: (
    shotId: string,
    ratio: EditorRatio,
    framing: { focusX: number; focusY: number; frameZoom: number | null } | null
  ) => void;
}) {
  const t = useStudioT();
  const [open, setOpen] = useState<{ shotId: string; ratio: string } | null>(null);
  const shots = document.scenes.flatMap((scene) => scene.shots);
  if (ratios.length === 0 || shots.length === 0) return null;

  return (
    <div className="studio-channel-framing">
      <p
        className={`studio-note ${status === "checking" ? "studio-note-accent" : ""}`}
        aria-live="polite"
        style={{ marginTop: 12 }}
      >
        {status === "checking" && <span className="studio-live-dot" aria-hidden />}{" "}
        {status === "checking"
          ? t("studio.channelFraming.checking")
          : status === "failed"
            ? t("studio.channelFraming.failed")
            : t("studio.channelFraming.ready")}
      </p>
      {ratios.map((ratio) => {
        const box = previewBoxStyle(ratio, "96px");
        return (
          <div key={ratio} style={{ marginTop: 12 }}>
            <span className="studio-label">{t("studio.channelFraming.title", { ratio })}</span>
            <div className="studio-channel-framing-strip">
              {shots.map((shot, index) => {
                const source = findSource(document, shot.sourceId);
                if (!source) return null;
                const framing = shotShapeFraming(shot, source, ratio as EditorRatio);
                const image =
                  thumbnails[shot.id] ??
                  source.posterUrl ??
                  (source.kind === "image" ? source.previewUrl : null);
                const isOpen = open?.shotId === shot.id && open.ratio === ratio;
                return (
                  <button
                    key={shot.id}
                    type="button"
                    className="studio-channel-framing-tile"
                    aria-pressed={isOpen}
                    aria-label={t("studio.channelFraming.tileAria", { number: index + 1, ratio })}
                    disabled={disabled}
                    style={{ width: `min(140px, ${box.width})` }}
                    onClick={() => setOpen(isOpen ? null : { shotId: shot.id, ratio })}
                  >
                    <span className="studio-framing-box" style={{ aspectRatio: box.aspectRatio }}>
                      {image && (
                        // eslint-disable-next-line @next/next/no-img-element -- a local frame
                        <img
                          src={image}
                          alt=""
                          draggable={false}
                          style={framingStyle(
                            source.aspect,
                            ratio,
                            framing.frameZoom,
                            framing.focusX,
                            framing.focusY
                          )}
                        />
                      )}
                    </span>
                    <span className="studio-shot-meta">
                      {index + 1}
                      {framing.automatic ? "" : ` · ${t("studio.channelFraming.yours")}`}
                    </span>
                  </button>
                );
              })}
            </div>
            {open?.ratio === ratio && (
              <OpenShot
                document={document}
                shot={shots.find((shot) => shot.id === open.shotId) ?? null}
                ratio={ratio as EditorRatio}
                image={open ? thumbnails[open.shotId] ?? null : null}
                disabled={disabled}
                onChange={onChange}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OpenShot({
  document,
  shot,
  ratio,
  image,
  disabled,
  onChange,
}: {
  document: EditorDocument;
  shot: EditorShot | null;
  ratio: EditorRatio;
  image: string | null;
  disabled: boolean;
  onChange: (
    shotId: string,
    ratio: EditorRatio,
    framing: { focusX: number; focusY: number; frameZoom: number | null } | null
  ) => void;
}) {
  const t = useStudioT();
  const source = shot ? findSource(document, shot.sourceId) : undefined;
  if (!shot || !source) return null;
  const framing = shotShapeFraming(shot, source, ratio);
  const sameShape =
    source.aspect != null && fillCoverage(source.aspect, aspectOfRatio(ratio)) >= 0.97;
  return (
    <div style={{ marginTop: 10 }}>
      <FramingControl
        source={source}
        shot={shot}
        ratio={ratio}
        disabled={disabled || sameShape}
        resolved={framing}
        imageUrl={image}
        autoLabel={t("studio.channelFraming.auto")}
        onAuto={() => onChange(shot.id, ratio, null)}
        onChange={(change) =>
          onChange(shot.id, ratio, {
            focusX: change.focusX ?? framing.focusX,
            focusY: change.focusY ?? framing.focusY,
            // A tap moves the focus only; the zoom stays exactly as shown.
            frameZoom: change.frameZoom ?? framing.frameZoom,
          })
        }
      />
    </div>
  );
}
