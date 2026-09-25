"use client";

import { useMemo } from "react";

import { PLATFORM_ASPECT_RATIOS, PLATFORM_LABELS, type Platform } from "@/domain/enums/Platform";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { DeviceRenderProgress } from "@/lib/mobile/deviceRenderClient";
import { partPercent } from "./renderTimeline";
import { RenderFailureLog } from "./RenderFailureLog";
import type { StudioChain, StudioOutput } from "./studioPipeline";
import { DownloadVideoButton, ResumeCallout, type ResumeControls } from "./DownloadVideoButton";
import { useStudioT } from "./studioI18n";

const STAGES: ("montage" | "master" | "final")[] = ["montage", "master", "final"];

/** The shapes the brief's channels need, each with the channels it serves. */
export function channelShapes(platforms: Platform[]): { ratio: string; channels: string[] }[] {
  const shapes: { ratio: string; channels: string[] }[] = [];
  for (const platform of platforms) {
    const ratio = PLATFORM_ASPECT_RATIOS[platform];
    const existing = shapes.find((shape) => shape.ratio === ratio);
    if (existing) existing.channels.push(PLATFORM_LABELS[platform]);
    else shapes.push({ ratio, channels: [PLATFORM_LABELS[platform]] });
  }
  return shapes;
}

/**
 * Channels: the other shapes of the approved video.
 *
 * The main video is rendered in the first channel's shape. Every other shape
 * the brief's channels need is a FULL render on this phone — picture, sound,
 * captions — from the originals, so it is the person's choice which ones to
 * make rather than something that happens behind their back.
 */
export function ChannelsPanel({
  requestId,
  resume = null,
  platforms,
  primaryRatio,
  currentStep,
  outputs,
  chain,
  selected,
  onToggle,
  onStart,
  onFinish,
  starting,
  error,
  busy,
  progress = null,
  elapsed = null,
  failure = null,
}: {
  requestId: string | null;
  /** Present while the shapes' render is paused (app was closed, Stop, or a failure). */
  resume?: ResumeControls | null;
  platforms: Platform[];
  primaryRatio: string;
  currentStep: string | null;
  outputs: StudioOutput[];
  chain: StudioChain | null;
  selected: string[];
  onToggle: (ratio: string) => void;
  onStart: () => void;
  onFinish: () => void;
  starting: boolean;
  error: string | null;
  busy: boolean;
  /** The phone's live progress on the part it is making. */
  progress?: DeviceRenderProgress | null;
  elapsed?: string | null;
  /** Why the phone's last try at a shape stopped, with its step-by-step log. */
  failure?: { summary: string; log: string[] } | null;
}) {
  const t = useStudioT();
  const shapes = useMemo(() => channelShapes(platforms), [platforms]);
  const others = shapes.filter((shape) => shape.ratio !== primaryRatio);
  // Choosing the shapes is also what takes the main video on from Render —
  // there is no separate approval to click first.
  const choosing =
    currentStep === VideoGenerationStep.AwaitingAdditionalRatios ||
    currentStep === VideoGenerationStep.AwaitingOverlayApproval;
  const rendering = currentStep === VideoGenerationStep.GeneratingAdditionalRatios;
  const done =
    currentStep === VideoGenerationStep.AwaitingDistributionReview ||
    currentStep === VideoGenerationStep.Complete;
  const before = !choosing && !rendering && !done;
  const outputFor = (ratio: string) => outputs.find((output) => output.ratio === ratio) ?? null;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.channels.title")}</h2>
        {before && <p className="studio-panel-hint">{t("studio.channels.before")}</p>}
        {choosing && (
          <p className="studio-panel-hint">
            {t("studio.channels.choosing", { ratio: primaryRatio })}
          </p>
        )}
        {rendering && resume && !busy && (
          <ResumeCallout resume={resume} what={t("studio.channels.pausedWhat")} />
        )}
        {rendering && !(resume && !busy) && (
          <p className="studio-note studio-note-accent" aria-live="polite">
            <span className="studio-live-dot" aria-hidden /> {t("studio.channels.rendering")}
            {elapsed ? t("studio.render.workingFor", { elapsed }) : ""}
            {t("studio.channels.keepOpen")}
          </p>
        )}
        {done && <p className="studio-note studio-note-positive">{t("studio.channels.done")}</p>}

        <ul className="studio-channel-list">
          {shapes.map((shape) => {
            const isPrimary = shape.ratio === primaryRatio;
            const output = outputFor(shape.ratio);
            const chosen = selected.includes(shape.ratio);
            return (
              <li key={shape.ratio} className="studio-channel">
                <div className="studio-channel-head">
                  {choosing && !isPrimary ? (
                    <button
                      type="button"
                      className="studio-chip"
                      aria-pressed={chosen}
                      disabled={starting || busy}
                      onClick={() => onToggle(shape.ratio)}
                    >
                      <strong>{shape.ratio}</strong>
                      <span>{shape.channels.join(", ")}</span>
                    </button>
                  ) : (
                    <span className="studio-channel-label">
                      <strong>{shape.ratio}</strong> {shape.channels.join(", ")}
                    </span>
                  )}
                  <span className="studio-shot-meta">
                    {isPrimary
                      ? t("studio.channels.main")
                      : output
                        ? t("studio.channels.ready")
                        : rendering && chain?.ratio === shape.ratio
                          ? t("studio.channels.renderingOne")
                          : rendering && chain?.queue.includes(shape.ratio)
                            ? t("studio.channels.waiting")
                            : done
                              ? t("studio.channels.notMade")
                              : ""}
                  </span>
                </div>
                {!output && !isPrimary && rendering && (
                  <ShapeProgress
                    ratio={shape.ratio}
                    chain={chain}
                    busy={busy}
                    progress={progress}
                  />
                )}
                {output && (
                  <video
                    src={output.url}
                    controls
                    playsInline
                    preload="metadata"
                    className="studio-player"
                    style={{ marginTop: 8 }}
                  />
                )}
                {output && requestId && (
                  <DownloadVideoButton
                    requestId={requestId}
                    assetId={output.assetId}
                    channel={shape.channels.join(", ")}
                    label={t("studio.channels.download", { ratio: shape.ratio })}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {choosing && (
          <div className="studio-approve">
            {others.length > 0 && (
              <button
                type="button"
                className="studio-button studio-button-primary"
                disabled={starting || busy || selected.length === 0}
                onClick={onStart}
              >
                {starting
                  ? t("studio.render.starting")
                  : t("studio.channels.renderMore", { count: selected.length })}
              </button>
            )}
            <button
              type="button"
              className="studio-button studio-button-ghost"
              disabled={starting || busy}
              onClick={onFinish}
            >
              {t("studio.channels.finishMain")}
            </button>
          </div>
        )}

        {failure && !busy && <RenderFailureLog summary={failure.summary} log={failure.log} />}
        {error && (
          <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>
    </>
  );
}

/**
 * One extra shape's progress, right under its channel: the three parts it is
 * made of, which one the phone is on, how far, and exactly where.
 */
function ShapeProgress({
  ratio,
  chain,
  busy,
  progress,
}: {
  ratio: string;
  chain: StudioChain | null;
  busy: boolean;
  progress: DeviceRenderProgress | null;
}) {
  const t = useStudioT();
  const live = busy && progress?.ratio === ratio ? progress : null;
  const stage = live?.stage ?? (chain?.ratio === ratio ? chain.stage : null);
  const queued = chain != null && chain.ratio !== ratio && chain.queue.includes(ratio);

  if (!stage) {
    return (
      <p className="studio-shot-meta" style={{ marginTop: 8 }}>
        {queued
          ? t("studio.channels.waitingAfter", { ratio: chain!.ratio })
          : t("studio.channels.waitingStart")}
      </p>
    );
  }

  const at = STAGES.indexOf(stage);
  const percent = live ? Math.round(partPercent(live)) : null;
  return (
    <div style={{ marginTop: 10 }}>
      <ol className="studio-render-steps">
        {STAGES.map((entry, index) => {
          const state = index < at ? "done" : index === at ? "active" : "waiting";
          return (
            <li key={entry} data-state={state}>
              <span className="studio-render-step-mark" aria-hidden>
                {state === "done" ? "✓" : index + 1}
              </span>
              <span className="studio-render-step-text">
                <strong>{t(`studio.part.${entry}`)}</strong>
                {state === "active" && live?.detail && (
                  <span className="studio-render-step-now">{live.detail}</span>
                )}
                {state === "active" && percent != null && (
                  <span className="studio-render-step-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                )}
              </span>
              <span className="studio-render-step-state">
                {state === "done"
                  ? t("studio.render.done")
                  : state === "active"
                    ? percent != null
                      ? `${percent}%`
                      : t("studio.channels.startingPart")
                    : t("studio.render.waiting")}
              </span>
            </li>
          );
        })}
      </ol>
      {live && (
        <p className="studio-shot-meta" style={{ marginTop: 6 }}>
          {live.message}
        </p>
      )}
    </div>
  );
}
