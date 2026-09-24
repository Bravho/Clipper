"use client";

import { useMemo } from "react";

import { PLATFORM_ASPECT_RATIOS, PLATFORM_LABELS, type Platform } from "@/domain/enums/Platform";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { DeviceRenderProgress } from "@/lib/mobile/deviceRenderClient";
import { partPercent } from "./renderTimeline";
import type { StudioChain, StudioOutput } from "./studioPipeline";

const STAGE_WORDS: Record<string, string> = {
  montage: "building the picture",
  master: "adding voice and music",
  final: "adding captions and look",
};

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
}: {
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
}) {
  const shapes = useMemo(() => channelShapes(platforms), [platforms]);
  const others = shapes.filter((shape) => shape.ratio !== primaryRatio);
  const choosing = currentStep === VideoGenerationStep.AwaitingAdditionalRatios;
  const rendering = currentStep === VideoGenerationStep.GeneratingAdditionalRatios;
  const done =
    currentStep === VideoGenerationStep.AwaitingDistributionReview ||
    currentStep === VideoGenerationStep.Complete;
  const before = !choosing && !rendering && !done;
  const outputFor = (ratio: string) => outputs.find((output) => output.ratio === ratio) ?? null;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">Channels</h2>
        {before && (
          <p className="studio-panel-hint">
            Approve the main video in Render first. Then choose which other channel shapes to make
            from it.
          </p>
        )}
        {choosing && (
          <p className="studio-panel-hint">
            The main video is {primaryRatio}. Choose the other shapes to render on this phone —
            each is a full render, so keep the app open.
          </p>
        )}
        {rendering && (
          <div className="studio-note studio-note-accent" aria-live="polite">
            <p style={{ margin: 0 }}>
              <span className="studio-live-dot" aria-hidden />{" "}
              {busy && progress?.ratio
                ? `Making ${progress.ratio} on this phone — ${
                    STAGE_WORDS[progress.stage ?? ""] ?? "working"
                  }`
                : chain
                  ? `Next: ${chain.ratio} — ${STAGE_WORDS[chain.stage] ?? chain.stage}`
                  : "Lining up the next shape…"}
              {busy && progress ? ` · ${Math.round(partPercent(progress))}%` : ""}
            </p>
            {busy && progress && (
              <div className="studio-progress" style={{ marginTop: 8 }}>
                <div
                  className="studio-progress-fill"
                  style={{ width: `${Math.round(partPercent(progress))}%` }}
                />
              </div>
            )}
            {busy && progress?.detail && (
              <p className="studio-render-step-now" style={{ marginTop: 6 }}>
                {progress.detail}
              </p>
            )}
            <p style={{ margin: "6px 0 0", fontSize: 12 }}>
              {chain && chain.queue.length > 0 ? `After this: ${chain.queue.join(", ")}. ` : ""}
              {elapsed ? `Working for ${elapsed}. ` : ""}
              Keep the app open — each shape is made on this phone.
            </p>
          </div>
        )}
        {done && <p className="studio-note studio-note-positive">Every chosen shape is ready.</p>}

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
                      ? "Main video"
                      : output
                        ? "Ready"
                        : rendering && chain?.ratio === shape.ratio
                          ? "Rendering"
                          : rendering && chain?.queue.includes(shape.ratio)
                            ? "Waiting"
                            : done
                              ? "Not made"
                              : ""}
                  </span>
                </div>
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
                  ? "Starting…"
                  : `Render ${selected.length} more shape${selected.length === 1 ? "" : "s"}`}
              </button>
            )}
            <button
              type="button"
              className="studio-button studio-button-ghost"
              disabled={starting || busy}
              onClick={onFinish}
            >
              Finish with the main video only
            </button>
          </div>
        )}

        {error && (
          <p className="studio-note studio-note-danger" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </section>
    </>
  );
}
