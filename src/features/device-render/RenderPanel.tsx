"use client";

import { Capacitor } from "@capacitor/core";
import {
  explainRefusal,
  type DeviceRenderAvailability,
  type DeviceRenderProgress,
} from "@/lib/mobile/deviceRenderClient";
import type { LocalDraftResult } from "./localDraft";
import type { RenderTimeline } from "./renderTimeline";

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
  video: { url: string; ratio: string; madeOn?: "phone" | "server" } | null;
  /** The video is waiting for the person's approval. */
  awaitingApproval: boolean;
  /** Already approved (the job has moved on to the channel shapes). */
  approved: boolean;
  approving: boolean;
  onApprove: () => void;
  error: string | null;
  /** The three parts of the video and where the phone is with them. */
  timeline: RenderTimeline | null;
  /** How long this phone has been working on the video, e.g. "1:24". */
  elapsed: string | null;
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
  const ready = main ? main.checklist.every((item) => item.done) : false;

  const preview = draft?.preview;
  const previewSrc = preview ? Capacitor.convertFileSrc(preview.path) : null;

  return (
    <>
      <section className="studio-panel">
        <h2 className="studio-panel-title">Ready to render</h2>
        <dl className="studio-stats">
          <div className="studio-stat">
            <dt>Picture</dt>
            <dd>{totalSeconds.toFixed(1)}s</dd>
          </div>
          <div className="studio-stat">
            <dt>Sound</dt>
            <dd>{hasVoice ? "Voice + bed" : "Silent"}</dd>
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
            This app build cannot render on the phone. Update the RClipper app — a studio
            video is rendered on this phone, not on the server.
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
                {main.starting ? "Starting…" : "Render the main video"}
              </button>
              <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
                {ready
                  ? "Sends your storyboard, sound and look, then this phone renders the video. Keep the app open."
                  : "Finish the steps above first."}
              </p>
            </div>
          </>
        )}
      </section>

      {main?.productionStarted && main.timeline && (
        <section className="studio-panel" aria-live="polite">
          <h2 className="studio-panel-title">
            <span className="studio-eyebrow" style={{ color: "var(--s-accent)" }}>
              {busy && <span className="studio-live-dot" aria-hidden />}
              {main.timeline.finished ? "Made on this phone" : "Making your video on this phone"}
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
                    ? "Done"
                    : entry.state === "active"
                      ? busy && entry.percent != null
                        ? `${entry.percent}%`
                        : "Next"
                      : "Waiting"}
                </span>
              </li>
            ))}
          </ol>

          {!main.timeline.finished && (
            <p className="studio-shot-meta" style={{ marginTop: 10 }}>
              {main.elapsed ? `Working for ${main.elapsed}. ` : ""}
              Keep the app open and the screen on — every frame is made here, on this phone.
            </p>
          )}
        </section>
      )}

      {progress && !main?.productionStarted && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">
            <span className="studio-eyebrow" style={{ color: "var(--s-accent)" }}>
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
          <strong>Production: </strong>
          {pipelineStatus}
        </p>
      )}

      {serverOutcome && (
        <p className="studio-note studio-note-accent">{serverOutcome}</p>
      )}

      {main?.video && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">Main video · {main.video.ratio}</h2>
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
              <strong>This video was not made on this phone.</strong> The server&apos;s video
              worker picked it up, and the server only has a still picture of each of your clips
              — so the clips play as snapshots. That worker needs updating so it leaves phone requests
              alone. Don&apos;t approve this one.
            </p>
          )}
          {main.video.madeOn === "phone" && (
            <p className="studio-shot-meta" style={{ marginTop: 8 }}>
              Made on this phone from your original clips and photos.
            </p>
          )}
          {main.awaitingApproval && (
            <div className="studio-approve">
              <button
                type="button"
                className="studio-button studio-button-primary"
                disabled={main.approving || busy}
                onClick={main.onApprove}
              >
                {main.approving ? "Approving…" : "Approve the video"}
              </button>
              <p className="studio-counter" style={{ textAlign: "left", margin: 0 }}>
                Next: choose which other channel shapes to make from it.
              </p>
            </div>
          )}
          {main.approved && (
            <p className="studio-note studio-note-positive" style={{ marginTop: 12 }}>
              Approved. The other channel shapes are made in Channels.
            </p>
          )}
        </section>
      )}

      {main?.error && <p className="studio-note studio-note-danger">{main.error}</p>}

      {availability && !availability.available && (
        <p className="studio-note">{explainRefusal(availability.reason)}</p>
      )}

      {preview && previewSrc && (
        <section className="studio-panel">
          <h2 className="studio-panel-title">What this phone produced</h2>
          <video
            key={preview.path}
            src={previewSrc}
            controls
            playsInline
            className="studio-player"
          />
          <dl className="studio-stats" style={{ marginTop: 12 }}>
            <div className="studio-stat">
              <dt>Length</dt>
              <dd>{preview.durationSeconds.toFixed(2)}s</dd>
            </div>
            <div className="studio-stat">
              <dt>Size</dt>
              <dd>{(preview.fileSizeBytes / 1e6).toFixed(1)} MB</dd>
            </div>
            <div className="studio-stat">
              <dt>Sound</dt>
              <dd style={{ color: preview.hasAudioTrack ? undefined : "var(--s-danger)" }}>
                {preview.hasAudioTrack ? "Present" : "None"}
              </dd>
            </div>
            <div className="studio-stat">
              <dt>Scene joins</dt>
              <dd>{preview.crossDissolved ? "Dissolve" : "Hard cuts"}</dd>
            </div>
          </dl>

          {!preview.crossDissolved && (
            <p className="studio-note studio-note-warning" style={{ marginTop: 12 }}>
              The dissolving composition would not export on this phone, so the scenes were
              joined with hard cuts. A server render dissolves them — worth noting when
              comparing the two.
            </p>
          )}
          {draft?.final?.coverPath && (
            <p className="studio-shot-meta" style={{ marginTop: 10 }}>
              A cover image was taken from this video&apos;s own frames.
            </p>
          )}
        </section>
      )}
    </>
  );
}
