import { RenderStep } from "@/domain/enums/RenderStep";

/**
 * Server-side knobs for phone rendering.
 *
 * `DEVICE_RENDER_ENABLED` is what admits real production jobs onto phones;
 * while it is off every claim is refused. The studio (/studio) is now the video
 * pipeline for every requester (the tester-only gate is retired), so this must
 * be "true" on the server wherever the studio is live.
 */
export const DEVICE_RENDER = {
  /**
   * Master switch. Off by default: an unfinished renderer that CAN claim
   * production work will claim production work.
   */
  enabled: process.env.DEVICE_RENDER_ENABLED === "true",

  /**
   * How long one device holds a claim before the Mac worker may reclaim it.
   *
   * Long enough that a slow phone finishing a 60 s export is not interrupted,
   * short enough that a phone the user force-quit does not strand the job for
   * the rest of the afternoon. The device heartbeats every
   * `heartbeatSeconds`; each heartbeat extends the lease.
   */
  leaseSeconds: Number(process.env.DEVICE_RENDER_LEASE_SECONDS ?? 600),

  /** How often the device is expected to report progress. */
  heartbeatSeconds: 20,

  /**
   * How long a device claim may go without a heartbeat before its own
   * requester may take it back and render it again.
   *
   * A studio request's tasks are `device_only`: the Mac worker's stale-claim
   * reclaim skips them, so a phone that was closed mid-render would otherwise
   * hold its claim for good and the video could never be resumed. Three missed
   * heartbeats means the app that held it is gone (or no longer rendering).
   */
  resumeAfterSeconds: Number(process.env.DEVICE_RENDER_RESUME_AFTER_SECONDS ?? 60),

  /**
   * Largest output a device may upload, per render.
   *
   * A 60 s 1080p H.264 export lands around 30–60 MB; 400 MB is generous enough
   * to never reject honest work and small enough that a bug cannot fill a
   * bucket.
   */
  maxOutputBytes: 400 * 1024 * 1024,

  /** Largest cover still. A 1080p JPEG is well under a megabyte. */
  maxCoverBytes: 4 * 1024 * 1024,

  /**
   * Steps a phone may claim.
   *
   * `OverlayComposition` is the integration target named in the design doc: it
   * starts from a completed, uncaptioned master and produces exactly one
   * `captionedExport_*` asset, so the blast radius of a wrong render is one
   * reviewable video rather than the whole pipeline. `AdditionalRatios` is the
   * same operation repeated per ratio and joins it once the primary ratio has
   * passed device validation.
   *
   * Montage, merge and compose stay on the worker until their phone equivalents
   * pass the fixtures in `docs/device-render-parity.md`.
   */
  eligibleSteps: [RenderStep.OverlayComposition] as RenderStep[],

  /**
   * Tolerances the server applies when inspecting an uploaded export.
   *
   * The device encoders are not FFmpeg, so byte-identical output is not the
   * bar — but a file that is the wrong SHAPE or materially the wrong LENGTH is
   * a broken render, and letting one through means a requester finds it.
   */
  validation: {
    /** Permitted duration drift from the manifest's expectation, seconds. */
    durationToleranceSeconds: 1.5,
    /** An export smaller than this is not a video. */
    minOutputBytes: 64 * 1024,
    /** A final export must carry an audio track; this is the floor for it. */
    requireAudioForFinal: true,
  },
} as const;

/** Is this step one a phone may take? */
export function isDeviceEligibleStep(step: string): boolean {
  return (DEVICE_RENDER.eligibleSteps as string[]).includes(step);
}
