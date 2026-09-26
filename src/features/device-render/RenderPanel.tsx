"use client";

import { Capacitor } from "@capacitor/core";
import {
  explainRefusal,
  type DeviceRenderAvailability,
  type DeviceRenderProgress,
} from "@/lib/mobile/deviceRenderClient";
import type { LocalDraftResult } from "./localDraft";
import { DownloadVideoButton, ResumeCallout, type ResumeControls } from "./DownloadVideoButton";
import type { RenderTimeline } from "./renderTimeline";
import { RenderFailureLog } from "./RenderFailureLog";
import { useStudioT } from "./studioI18n";

/** One thing that has to be true before the main video can be rendered. */
export interface RenderReadiness {
  label: string;
  done: boolean;
}

/** The start / review / approve controls for the request's main video. */
export interface MainVideoControls {
  /** What has to be done first; all `done` means Render can be pressed. */
  checklist: RenderReadiness[];
  /** The production plan has been sent; the phone renders from here on. */
  productionStarted: boolean;
  starting: boolean;
  onStart: () => void;
  /** The finished, captioned main video, once the phone has rendered it. */
  video: {
    url: string;
    ratio: string;
    madeOn?: "phone" | "server";
    assetId: string;
  } | null;
  /** The request, for the download link. */
  requestId: string;
  /** The first channel's names, to name the downloaded file. */
  channel?: string;
  /** Present while the render is paused (app was closed, Stop, or a failure). */
  resume: ResumeControls | null;
  /** The finished video is here and nothing has been made from it yet. */
  atReview: boolean;
  /** Taken on to Channels (the job has moved on to the channel shapes). */
  approved: boolean;
  /** Remaking it from the current storyboard, sound and look. */
  regenerating: boolean;
  onRegenerate: () => void;
  /** Why it cannot be remade yet (the first unmet checklist item), or null. */
  regenerateBlocker: string | null;
  /** Approved steps are final: no "Regenerate the video" at all. */
  regenerateLocked?: boolean;
  onChannels: () => void;
  error: string | null;
  /** The three parts of the video and where the phone is with them. */
  timeline: RenderTimeline | null;
  /** How long this phone has been working on the video, e.g. "1:24". */
  elapsed: string | null;
  /** Why the phone's last try at a part stopped, when it stopped with an error. */
  phoneError?: string | null;
  /** That try's step-by-step log (app + phone renderer). */
  phoneErrorLog?: string[];
}

/**
 * Render, watch it happen, and look at what came out.
 *
 * TWO ACTIONS, TWO MEANINGS, SAID PLAINLY. "Draft on this phone" renders and
 * stops; nothing leaves the device. "Render this request" takes the queued step,
 * uploads the result and lets the server verify and attach it. Which one was
 * pressed has to be obvious without reading the code.
 *
 * The outputs section reports what the phone actually produced — length, size,
 * whether there is sound, whether the scene joins are real dissolves — because
 * comparing against a server render is the point of this screen, and "looks
 * about right" is not a comparison.
 */
export function RenderPanel({
  problems,
  totalSeconds,
  busy,
  nativeReady,
  hasVoice,
  availability,
  progress,
  draft,
  serverOutcome,
  pipelineStatus = null,
  main = null,
}: {
  problems: string[];
  totalSeconds: number;
  busy: boolean;
  nativeReady: boolean;
  hasVoice: boolean;
  availability: DeviceRenderAvailability | null;
  progress: DeviceRenderProgress | null;
  draft: LocalDraftResult | null;
  serverOutcome: string | null;
  /** Where the request's pipeline is, in words. */
  pipelineStatus?: string | null;
  /** Present when the studio is attached to a request. */
  main?: MainVideoControls | null;
}) {
  const t = useStudioT();
  const ready = main ? main.checklist.every((item) => item.done) : false;

  const preview = draft?.preview;
  const previewSrc = preview ? Capacitor.convertFileSrc(preview.path) : null;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">{t("studio.render.readyTitle")}</h2>
        <dl className="studio-stats">
          <div className="studio-stat">
            <dt>{t("studio.render.picture")}</dt>
            <dd>{totalSeconds.toFixed(1)}s</dd>
          </div>
          <div className="studio-stat">
            <dt>{t("studio.render.sound")}</dt>
            <dd>{hasVoice ? t("studio.render.voiceBed") : t("studio.render.silent")}</dd>
          </div>
        </dl>

        {problems.length > 0 && (
          <ul
            className="studio-note studio-note-warning"
            style={{ marginTop: 12, paddingLeft: 30, display: "grid", gap: 4 }}
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {!nativeReady && problems.length === 0 && (
          <p className="studio-note studio-note-warning" style={{ marginTop: 12 }}>
            {t("studio.render.cannotRender")}
          </p>
        )}

        {main && !main.productionStarted && (
          <>
            <ul className="studio-checklist">
              {main.checklist.map((item) => (
                <li key={item.label} data-done={item.done}>
                  <span aria-hidden>{item.done ? "✓" : "○"}</span>
                  {item.label}
                </li>
              ))}
            </ul>
            <div className="studio-approve">
              <button
                type="button"
                className="studio-button studio-button-primary"
                disabled={!ready || !nativeReady || main.starting || busy}
                onClick={main.onStart}
              >
                {main.starting ? t("studio.render.starting") : t("studio.render.renderMain")}
              </button>
              <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
                {ready
                  ? t("studio.render.readyHint")
                  : t("studio.render.finishFirst")}
              </p>
            </div>
          </>
        )}
      </section>

      {main?.productionStarted && main.timeline && (
        <section className="studio-panel" aria-live="polite">
          <h2 className="studio-panel-title">
            <span className="studio-eyebrow" style={{ color: "var(--s-accent-text)" }}>
              {busy && <span className="studio-live-dot" aria-hidden />}
              {main.timeline.finished ? t("studio.render.madeHere") : t("studio.render.making")}
            </span>
          </h2>
          <div
            className="studio-progress"
            role="progressbar"
            aria-valuenow={main.timeline.overallPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="studio-progress-fill"
              style={{ width: `${main.timeline.overallPercent}%` }}
            />
          </div>
          <p className="studio-render-status">
            <strong>{main.timeline.overallPercent}%</strong>
            <span>{main.timeline.status}</span>
          </p>

          <ol className="studio-render-steps">
            {main.timeline.steps.map((entry, index) => (
              <li key={entry.id} data-state={entry.state}>
                <span className="studio-render-step-mark" aria-hidden>
                  {entry.state === "done" ? "✓" : index + 1}
                </span>
                <span className="studio-render-step-text">
                  <strong>{entry.label}</strong>
                  <span>{entry.detail}</span>
                  {entry.state === "active" && busy && main.timeline!.now && (
                    <span className="studio-render-step-now">{main.timeline!.now}</span>
                  )}
                  {entry.state === "active" && entry.percent != null && busy && (
                    <span className="studio-render-step-bar">
                      <span style={{ width: `${entry.percent}%` }} />
                    </span>
                  )}
                </span>
                <span className="studio-render-step-state">
                  {entry.state === "done"
                    ? t("studio.render.done")
                    : entry.state === "active"
                      ? busy && entry.percent != null
                        ? `${entry.percent}%`
                        : t("studio.render.next")
                      : t("studio.render.waiting")}
                </span>
              </li>
            ))}
          </ol>

          {!main.timeline.finished && main.resume && !busy && (
            <ResumeCallout resume={main.resume} what={t("studio.render.pausedMain")} />
          )}

          {main.phoneError && !busy && !main.timeline.finished && (
            <RenderFailureLog summary={main.phoneError} log={main.phoneErrorLog ?? []} />
          )}
          {!main.timeline.finished && !main.resume && (
            <p className="studio-shot-meta" style={{ marginTop: 10 }}>
              {main.elapsed ? t("studio.render.workingFor", { elapsed: main.elapsed }) : ""}
              {t("studio.render.keepOpen")}
            </p>
          )}
        </section>
      )}

      {progress && !main?.productionStarted && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">
            <span className="studio-eyebrow" style={{ color: "var(--s-accent-text)" }}>
              {busy && <span className="studio-live-dot" aria-hidden />}
              {progress.phase}
            </span>
          </h2>
          <div className="studio-progress" role="progressbar" aria-valuenow={Math.round(progress.percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="studio-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="studio-panel-hint" style={{ margin: "10px 0 0" }}>
            {progress.message} ({Math.round(progress.percent)}%)
          </p>
          {progress.detail && <p className="studio-render-step-now">{progress.detail}</p>}
        </section>
      )}

      {pipelineStatus && !main?.productionStarted && (
        <p className="studio-note">
          <strong>{t("studio.render.production")}</strong>
          {pipelineStatus}
        </p>
      )}

      {serverOutcome && (
        <p className="studio-note studio-note-accent">{serverOutcome}</p>
      )}

      {main?.video && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">
            {t("studio.render.mainVideo", { ratio: main.video.ratio })}
          </h2>
          <video
            key={main.video.url}
            src={main.video.url}
            controls
            playsInline
            preload="metadata"
            className="studio-player"
          />
          {main.video.madeOn === "server" && (
            <p className="studio-note" role="alert" style={{ marginTop: 10 }}>
              <strong>{t("studio.render.serverMadeTitle")}</strong>{" "}
              {t("studio.render.serverMadeBody")}
            </p>
          )}
          {main.video.madeOn === "phone" && (
            <p className="studio-shot-meta" style={{ marginTop: 8 }}>
              {t("studio.render.madeFromOriginals")}
            </p>
          )}
          <DownloadVideoButton
            requestId={main.requestId}
            assetId={main.video.assetId}
            channel={main.channel}
            label={t("studio.render.downloadMain", { ratio: main.video.ratio })}
          />
          {main.atReview && (
            <>
              <p className="studio-note studio-note-positive" style={{ marginTop: 12 }}>
                {t("studio.render.videoReady")}
              </p>
              <div className="studio-approve">
                <button
                  type="button"
                  className="studio-button studio-button-primary"
                  disabled={busy || main.regenerating}
                  onClick={main.onChannels}
                >
                  {t("studio.render.toChannels")}
                </button>
                {main.regenerateLocked ? (
                  <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
                    {t("studio.render.lockedHint")}
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="studio-button studio-button-ghost"
                      disabled={busy || main.regenerating || main.regenerateBlocker !== null}
                      onClick={main.onRegenerate}
                    >
                      {main.regenerating ? t("studio.render.startingAgain") : t("studio.render.regenerate")}
                    </button>
                    <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
                      {main.regenerateBlocker
                        ? t("studio.render.toRegenerate", {
                            what: `${main.regenerateBlocker.charAt(0).toLowerCase()}${main.regenerateBlocker.slice(1)}`,
                          })
                        : t("studio.render.regenerateHint")}
                    </p>
                  </>
                )}
              </div>
            </>
          )}
          {main.approved && (
            <p className="studio-note studio-note-positive" style={{ marginTop: 12 }}>
              {t("studio.render.mainDone")}
            </p>
          )}
        </section>
      )}

      {main?.error && <p className="studio-note studio-note-danger">{main.error}</p>}

      {availability && !availability.available && (
        <p className="studio-note">{explainRefusal(availability.reason, t)}</p>
      )}

      {preview && previewSrc && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">{t("studio.render.produced")}</h2>
          <video
            key={preview.path}
            src={previewSrc}
            controls
            playsInline
            className="studio-player"
          />
          <dl className="studio-stats" style={{ marginTop: 12 }}>
            <div className="studio-stat">
              <dt>{t("studio.render.length")}</dt>
              <dd>{preview.durationSeconds.toFixed(2)}s</dd>
            </div>
            <div className="studio-stat">
              <dt>{t("studio.render.size")}</dt>
              <dd>{(preview.fileSizeBytes / 1e6).toFixed(1)} MB</dd>
            </div>
            <div className="studio-stat">
              <dt>{t("studio.render.sound")}</dt>
              <dd style={{ color: preview.hasAudioTrack ? undefined : "var(--s-danger)" }}>
                {preview.hasAudioTrack ? t("studio.render.present") : t("studio.render.none")}
              </dd>
            </div>
            <div className="studio-stat">
              <dt>{t("studio.render.joins")}</dt>
              <dd>{preview.crossDissolved ? t("studio.render.dissolve") : t("studio.render.hardCuts")}</dd>
            </div>
          </dl>

          {!preview.crossDissolved && (
            <p className="studio-note studio-note-warning" style={{ marginTop: 12 }}>
              {t("studio.render.hardCutsNote")}
            </p>
          )}
          {draft?.final?.coverPath && (
            <p className="studio-shot-meta" style={{ marginTop: 10 }}>
              {t("studio.render.cover")}
            </p>
          )}
        </section>
      )}
    </>
  );
}
