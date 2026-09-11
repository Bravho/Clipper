import * as os from "os";
import type { X264Preset } from "@remotion/renderer";

/**
 * Performance knobs for every Remotion render in the pipeline.
 *
 * WHY THIS EXISTS. `renderMedia` was called with only `codec` and
 * `pixelFormat`, so every render used Remotion's defaults: half the cores for
 * frame capture and libx264's `medium` preset. On the Mac Mini worker the
 * renders are the pipeline's whole cost (the additional-ratios step alone was
 * measured at 41.5 min of a 61 min job), so the defaults are leaving the
 * machine idle.
 *
 * Every value here is overridable by an environment variable so a bad setting
 * can be reverted on the worker WITHOUT a deploy — set the variable, restart
 * the worker. The defaults are what the worker runs with when nothing is set.
 */

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const X264_PRESETS: readonly string[] = [
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow", "placebo",
];

const HARDWARE_ACCELERATION = ["disable", "if-possible", "required"] as const;
export type HardwareAcceleration = (typeof HARDWARE_ACCELERATION)[number];

function parseX264Preset(raw: string | undefined, fallback: X264Preset): X264Preset {
  return X264_PRESETS.includes(raw ?? "") ? (raw as X264Preset) : fallback;
}

function parseHardwareAcceleration(
  raw: string | undefined,
  fallback: HardwareAcceleration
): HardwareAcceleration {
  return (HARDWARE_ACCELERATION as readonly string[]).includes(raw ?? "")
    ? (raw as HardwareAcceleration)
    : fallback;
}

export const RENDER_TUNING = {
  /**
   * Frames captured in parallel. Remotion's default is roughly half the cores;
   * the worker does nothing else while rendering, so give it all of them.
   *
   * Lower this first if the M4's 16 GB comes under pressure — each concurrent
   * frame worker is a headless Chromium tab holding decoded frames. Set
   * REMOTION_CONCURRENCY=4 (etc.) to pin it.
   */
  concurrency: parsePositiveInt(process.env.REMOTION_CONCURRENCY, os.cpus().length),

  /**
   * libx264 speed/compression trade-off for H.264 output (the montage segments
   * and the styled per-ratio videos). `veryfast` encodes several times quicker
   * than the `medium` default; at the same bitrate it spends more bits for the
   * same picture, which is the right trade here because the output is
   * re-encoded downstream anyway.
   *
   * Set REMOTION_X264_PRESET=medium to restore the previous behaviour.
   */
  x264Preset: parseX264Preset(process.env.REMOTION_X264_PRESET, "veryfast"),

  /**
   * VideoToolbox hardware encoding. On Apple silicon this moves H.264 encoding
   * off the CPU entirely. `if-possible` is safe by construction: Remotion falls
   * back to software encoding when the platform or codec can't support it, so
   * this can never fail a render — unlike `required`.
   *
   * Set REMOTION_HARDWARE_ACCELERATION=disable to force software encoding.
   * NOTE: when hardware encoding engages, `x264Preset` no longer applies (it is
   * a libx264 option), so compare the two settings independently.
   */
  hardwareAcceleration: parseHardwareAcceleration(
    process.env.REMOTION_HARDWARE_ACCELERATION,
    "if-possible"
  ),

  /**
   * Serve the per-ratio master to Remotion from a local file over loopback
   * instead of its public DO Spaces URL (see `withLocalMasterUrl`). Set
   * RENDER_LOCAL_MASTER=false to go back to fetching the master over the
   * internet once per ratio.
   */
  localMasterEnabled: process.env.RENDER_LOCAL_MASTER !== "false",
} as const;
