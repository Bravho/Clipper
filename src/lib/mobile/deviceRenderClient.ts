"use client";

import { Capacitor } from "@capacitor/core";
import {
  validateDeviceRenderManifest,
  type DeviceRenderManifest,
  type DeviceRenderStage,
} from "@/lib/mobile/deviceRenderContract";
import {
  cancelDeviceRender,
  observeManifestProgress,
  releaseRenderedOutput,
  renderManifestOnDevice,
  stageManifestSources,
  supportsManifestRender,
  type NativeManifestResult,
} from "@/lib/mobile/deviceRenderBridge";
import { getNativeRenderCapabilities } from "@/lib/mobile/deviceVideoRender";
import type { LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";
import { describeRenderPosition, planFromManifest } from "@/lib/mobile/renderProgressDetail";

/**
 * The whole phone-render round trip, as one call.
 *
 * claim → render → authorise upload → upload → assemble → complete, with a
 * heartbeat running underneath and a release on every failure path.
 *
 * THE RELEASE IS THE IMPORTANT PART. Anything that goes wrong after a claim has
 * to hand the render task back, or the requester waits out a full lease while
 * nothing renders. Every throw below is funnelled through one `finally` that
 * releases, and the server keeps the task's FIFO position, so a failed phone
 * render costs a few seconds rather than a place in the queue.
 *
 * LOCAL FILES ARE KEPT UNTIL THE SERVER CONFIRMS. The rendered output is
 * released only after `complete` returns, so a completion that has to be
 * retried still has its bytes.
 */

export type DeviceRenderPhase =
  | "idle"
  | "checking"
  | "claiming"
  | "rendering"
  | "uploading"
  | "finishing"
  | "done"
  | "released"
  | "failed";

export interface DeviceRenderProgress {
  phase: DeviceRenderPhase;
  /** 0-100 within the current phase. */
  percent: number;
  message: string;
  /** Which part of the video this is, once the server has handed it out. */
  stage?: DeviceRenderStage;
  /** The shape being rendered, e.g. "9:16". */
  ratio?: string;
  /**
   * What exactly the phone is on: which original it is copying, which scene
   * and shot it is encoding, which caption is on screen, how much is sent.
   */
  detail?: string;
}

export interface DeviceRenderAvailability {
  available: boolean;
  reason?: string;
  step?: string;
  stage?: DeviceRenderStage;
  ratio?: string;
}

export interface DeviceRenderOutcome {
  status: "completed" | "refused" | "released" | "failed";
  reason?: string;
  assetId?: string | null;
  /** What the phone actually produced, for the on-device preview. */
  preview?: { path: string; durationSeconds: number; crossDissolved: boolean };
}

/** Reasons the UI should explain rather than show as an error. */
const REFUSAL_COPY: Record<string, string> = {
  device_rendering_disabled: "Rendering on this phone is not switched on yet for this account.",
  no_render_queued: "There is nothing waiting to be rendered for this video right now.",
  already_rendering: "The server is already rendering this step.",
  step_runs_on_server: "This step runs on the server, not on a phone.",
  inputs_unavailable: "The server does not have everything this phone would need yet.",
  manifest_unavailable: "The render could not be prepared; the server will do this one.",
  request_not_found: "This video could not be found.",
  job_not_found: "This video has no production job to render.",
  unsupported_app_build: "This app build cannot render video. Update the app.",
  unsupported_encoder: "This phone cannot encode H.264 and AAC.",
  app_not_foreground: "Keep RClipper open on screen while it renders.",
  low_power_mode: "Turn off Low Power Mode to render on this phone.",
  unsupported_duration: "This video is too long to render on a phone.",
  unsupported_output_size: "This output size is too large to render on a phone.",
  insufficient_storage: "There is not enough free space on this phone to render.",
};

export function explainRefusal(reason?: string): string {
  if (!reason) return "This phone cannot take this render right now.";
  return REFUSAL_COPY[reason] ?? `This phone cannot take this render right now (${reason}).`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`
    );
  }
  return payload as T;
}

/** What the server would hand this phone, without taking a lease. */
export async function checkDeviceRenderAvailability(
  requestId: string
): Promise<DeviceRenderAvailability> {
  const response = await fetch(
    `/api/device-render/availability?requestId=${encodeURIComponent(requestId)}`
  );
  if (response.status === 404) return { available: false, reason: "not_enabled_for_account" };
  if (!response.ok) return { available: false, reason: "unavailable" };
  return (await response.json()) as DeviceRenderAvailability;
}

export interface RunDeviceRenderInput {
  requestId: string;
  /** Device-private originals, so a local-first manifest can be staged. */
  localMedia?: Map<string, LocalMediaDescriptor>;
  onProgress?: (progress: DeviceRenderProgress) => void;
  /** Resolves true when the user has asked to stop. */
  shouldCancel?: () => boolean;
}

/**
 * Claim, render and complete one queued step on this phone.
 *
 * Returns rather than throws for the outcomes that are not bugs — a refusal, a
 * cancellation — so the caller can show a sentence instead of a stack trace.
 */
export async function runDeviceRender(
  input: RunDeviceRenderInput
): Promise<DeviceRenderOutcome> {
  // Set once the claim says which part of the video this is, so every report
  // after that can name it.
  let stage: DeviceRenderStage | undefined;
  let ratio: string | undefined;
  const report = (
    phase: DeviceRenderPhase,
    percent: number,
    message: string,
    detail?: string
  ) => input.onProgress?.({ phase, percent, message, stage, ratio, detail });

  report("checking", 0, "Checking what this phone can render…");

  if (!Capacitor.isNativePlatform()) {
    return { status: "refused", reason: "not_a_native_build" };
  }
  const capabilities = await getNativeRenderCapabilities();
  if (!capabilities || !(await supportsManifestRender())) {
    return { status: "refused", reason: "unsupported_app_build" };
  }

  const claim = await postJson<
    | { claimed: false; reason: string }
    | { claimed: true; attemptId: string; manifest: unknown; heartbeatSeconds: number }
  >("/api/device-render/claim", {
    requestId: input.requestId,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? undefined,
    capabilities: {
      platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
      nativePluginVersion: capabilities.nativePluginVersion,
      freeBytes: capabilities.freeBytes,
      supportsH264Encode: capabilities.supportsH264Encode,
      supportsAacEncode: capabilities.supportsAacEncode,
      // The render is foreground work by construction: this runs from a screen
      // the user is looking at, and the server refuses a background claim.
      appInForeground: document.visibilityState === "visible",
      lowPowerMode: false,
    },
  });

  if (!claim.claimed) return { status: "refused", reason: claim.reason };

  const { attemptId, heartbeatSeconds } = claim;
  let manifest: DeviceRenderManifest;
  try {
    // Validate what the server sent before rendering it. The server validates
    // on the way out too; doing it again here means a contract mismatch shows
    // up as a clear message rather than as a video that looks wrong.
    manifest = validateDeviceRenderManifest(claim.manifest);
    stage = manifest.stage;
    ratio = manifest.ratio;
  } catch (error) {
    await release(attemptId, "invalid_manifest");
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "The render manifest was not usable.",
    };
  }

  let rendered: NativeManifestResult | null = null;
  let completed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stopProgress: (() => Promise<void>) | null = null;
  let cancelledByServer = false;

  // Declared before the heartbeat that reads it: an interval firing into a
  // `let` that has not been initialised yet is a TDZ throw inside a timer,
  // which surfaces as a silent dead heartbeat and a lost lease.
  let lastReportedPercent = 0;

  try {
    heartbeat = setInterval(() => {
      void postJson<{ ok: boolean; cancelled: boolean }>(
        `/api/device-render/${attemptId}/progress`,
        { percent: lastReportedPercent }
      )
        .then((result) => {
          // The server tells us when the work was reclaimed. Stopping here
          // saves minutes of encoding for an export it would refuse anyway.
          if (result.cancelled) {
            cancelledByServer = true;
            void cancelDeviceRender();
          }
        })
        .catch(() => {});
    }, Math.max(5, heartbeatSeconds) * 1000);

    // What is where in this video, so every percentage can say what it is on.
    const fileNames = new Map<string, string>();
    for (const [localId, descriptor] of input.localMedia ?? new Map()) {
      fileNames.set(localId, descriptor.fileName);
    }
    const plan = planFromManifest(manifest, fileNames);
    // Filled in once the file exists; read by the upload progress callback.
    const uploadNote: { detail?: string } = {};

    stopProgress = await observeManifestProgress({
      onRender: (percent) => {
        lastReportedPercent = percent;
        report(
          "rendering",
          percent,
          "Rendering on this phone…",
          describeRenderPosition(plan, percent)
        );
      },
      onUpload: (percent) =>
        report("uploading", percent, "Uploading the finished video…", uploadNote.detail),
    });

    report("rendering", 0, "Preparing the approved media…", "Finding your originals on this phone…");

    const staged = await stageManifestSources(
      manifest,
      input.localMedia ?? new Map(),
      (done, total) =>
        report(
          "rendering",
          0,
          "Preparing the approved media…",
          `Getting your originals ready — ${done} of ${total}`
        )
    );
    if (input.shouldCancel?.()) throw new CancelledError();

    rendered = await renderManifestOnDevice(manifest, staged);
    if (cancelledByServer) throw new SupersededError();
    if (input.shouldCancel?.()) throw new CancelledError();

    const megabytes = (rendered.fileSizeBytes / 1_000_000).toFixed(1);
    uploadNote.detail = `Sending ${megabytes} MB (${rendered.durationSeconds.toFixed(1)}s of video) to your request`;
    report("uploading", 0, "Asking for somewhere to put the video…", uploadNote.detail);
    const upload = await postJson<{
      storageKey: string;
      uploadId: string;
      partSizeBytes: number;
      parts: { partNumber: number; url: string }[];
      coverStorageKey: string | null;
      coverUrl: string | null;
      expiresAt: string;
    }>(`/api/device-render/${attemptId}/upload`, {
      action: "authorize",
      fileSizeBytes: rendered.fileSizeBytes,
      coverBytes: rendered.coverPath ? 1 : null,
    });

    const { uploadRenderedOutput } = await import("@/lib/mobile/deviceRenderBridge");
    const parts = await uploadRenderedOutput({
      path: rendered.path,
      partUrls: upload.parts
        .slice()
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((part) => part.url),
      partSizeBytes: upload.partSizeBytes,
      coverPath: rendered.coverPath ?? null,
      coverUrl: upload.coverUrl,
    });

    report("finishing", 0, "Assembling the upload…", "Joining the uploaded pieces into one file");
    await postJson(`/api/device-render/${attemptId}/upload`, { action: "finish", parts });

    report(
      "finishing",
      50,
      "Checking the finished video…",
      "The server is checking its length, picture size, format and sound"
    );
    const result = await postJson<{ ok: true; assetId: string | null }>(
      `/api/device-render/${attemptId}/complete`,
      {
        jobId: manifest.jobId,
        step: manifest.step,
        stage: manifest.stage,
        ratio: manifest.ratio,
        manifestVersion: manifest.version,
        storageKey: upload.storageKey,
        coverStorageKey: rendered.coverPath ? upload.coverStorageKey : null,
        fileSizeBytes: rendered.fileSizeBytes,
        durationSeconds: rendered.durationSeconds,
        width: rendered.width,
        height: rendered.height,
        hasAudioTrack: rendered.hasAudioTrack,
      }
    );

    completed = true;
    report("done", 100, "Done. The server has the finished video.");
    return {
      status: "completed",
      assetId: result.assetId,
      preview: {
        path: rendered.path,
        durationSeconds: rendered.durationSeconds,
        crossDissolved: rendered.crossDissolved,
      },
    };
  } catch (error) {
    await cancelDeviceRender();
    const reason =
      error instanceof CancelledError
        ? "cancelled"
        : error instanceof SupersededError
          ? "taken_over_by_server"
          : error instanceof Error
            ? error.message
            : String(error);
    await release(attemptId, reason);
    report(
      error instanceof CancelledError ? "released" : "failed",
      0,
      error instanceof CancelledError
        ? "Stopped. The server will render this one."
        : `This phone could not finish: ${reason}`
    );
    return {
      status: error instanceof CancelledError ? "released" : "failed",
      reason,
      ...(rendered
        ? {
            preview: {
              path: rendered.path,
              durationSeconds: rendered.durationSeconds,
              crossDissolved: rendered.crossDissolved,
            },
          }
        : {}),
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await stopProgress?.();
    // Keep the local file until the server confirms; after that it is a
    // duplicate of something already in storage.
    if (completed && rendered) await releaseRenderedOutput(rendered.path);
  }
}

/** Hand the render task back so the Mac Mini worker takes it. */
export async function release(attemptId: string, reason: string): Promise<void> {
  await postJson(`/api/device-render/${attemptId}/release`, {
    reason: reason.slice(0, 200),
  }).catch(() => {
    // A release that cannot be delivered is not fatal: the lease expires on its
    // own and the worker reclaims the task. Losing the render for good would be
    // worse than losing a few minutes.
  });
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

class SupersededError extends Error {
  constructor() {
    super("taken_over_by_server");
    this.name = "SupersededError";
  }
}
