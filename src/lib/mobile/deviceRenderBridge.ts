"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { DeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";
import {
  getNativeRenderCapabilities,
  releaseStagedLocalSource,
  stageLocalSourceForNative,
} from "@/lib/mobile/deviceVideoRender";
import {
  descriptorForLocalId,
  readLocalMaterial,
} from "@/features/requests/localMediaStore";
import { canRenderManifestOnDevice } from "@/lib/mobile/deviceRenderPluginVersion";
import type { LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";

/**
 * The v5 half of the native bridge: render a whole manifest, and upload what it
 * produced.
 *
 * Kept separate from `deviceVideoRender.ts` on purpose. That module is the v1-v4
 * surface — staging, the single-clip primitive, the silent timeline, the audible
 * draft — and installed apps still run it. This module is only reachable once a
 * device reports plugin version 5, so a build that predates the editor can go on
 * working as a draft tester instead of failing on a method it does not have.
 */

// The version constant lives in its own server-safe module because the submit
// route has to check the same number, and this file cannot be imported there —
// it is a client module that pulls in Capacitor.
export { MANIFEST_RENDER_PLUGIN_VERSION } from "@/lib/mobile/deviceRenderPluginVersion";

export interface NativeManifestResult {
  /** Native path of the rendered MP4. Release it once the server confirms. */
  path: string;
  fileSizeBytes: number;
  durationSeconds: number;
  hasAudioTrack: boolean;
  width: number;
  height: number;
  stage: string;
  /**
   * Whether the montage's scene joins are true cross-dissolves.
   *
   * Android builds the dissolve from a two-sequence composition, which is the
   * one operation with no FFmpeg equivalent; if that fails to export it retries
   * with hard cuts. A tester comparing a phone export against the Mac's needs to
   * know which they are looking at, so the flag is surfaced rather than buried.
   */
  crossDissolved: boolean;
  /**
   * Android only: the final export failed with the motion template and was
   * redone with captions alone. Absent from builds that predate the fallback.
   */
  templateDropped?: boolean;
  /** Native path of the cover still, for a stage that produces one. */
  coverPath?: string;
}

export interface NativeUploadPart {
  partNumber: number;
  eTag: string;
}

interface DeviceManifestRenderPlugin {
  renderManifest(input: {
    manifest: string;
    stagedSources: { key: string; sourceUrl: string }[];
  }): Promise<NativeManifestResult>;
  uploadOutput(input: {
    path: string;
    partUrls: string[];
    partSizeBytes: number;
    coverPath?: string;
    coverUrl?: string;
  }): Promise<{ parts: NativeUploadPart[] }>;
  cancel(): Promise<void>;
  releaseOutput(input: { path: string }): Promise<void>;
  addListener(
    eventName: "renderProgress" | "uploadProgress",
    listener: (event: { percent: number }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeRenderer = registerPlugin<DeviceManifestRenderPlugin>("DeviceVideoRender");

/** Can this build render a manifest, or only the older draft primitives? */
export async function supportsManifestRender(): Promise<boolean> {
  const capabilities = await getNativeRenderCapabilities();
  return Boolean(
    capabilities &&
      canRenderManifestOnDevice(capabilities.nativePluginVersion) &&
      capabilities.supportsH264Encode &&
      capabilities.supportsAacEncode
  );
}

/**
 * What this build can do, in the shape the submission contract declares.
 *
 * Sent with a local-first submission so the server can refuse to let a CLIP
 * stay on a phone that could not render it — a request whose only footage is on
 * a device with no renderer has no renderer anywhere, and would sit in the
 * queue forever.
 */
export async function describeDeviceRenderCapability(): Promise<{
  nativePluginVersion: number;
  canRenderManifest: boolean;
  platform: "ios" | "android";
} | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  const capabilities = await getNativeRenderCapabilities();
  if (!capabilities) return undefined;
  return {
    nativePluginVersion: capabilities.nativePluginVersion,
    canRenderManifest: await supportsManifestRender(),
    platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
  };
}

/** One device-private original, staged into native cache for the renderer. */
export interface StagedLocalSource {
  key: string;
  sourceUrl: string;
}

/**
 * Copy the device-private originals a manifest names into native cache.
 *
 * This is the whole point of the local-first path: a photo or clip the
 * requester chose never leaves the phone, so the manifest refers to it by
 * `localId` and the bytes move from the WebView's private storage into the
 * plugin's cache without touching the network. Anything with a `url` is left
 * alone — the renderer fetches it itself.
 *
 * The caller MUST release these afterwards; `renderManifestOnDevice` does.
 */
export async function stageManifestSources(
  manifest: DeviceRenderManifest,
  descriptorsByLocalId: Map<string, LocalMediaDescriptor>,
  /** Called after each original is ready: (done, total). */
  onProgress?: (done: number, total: number) => void
): Promise<StagedLocalSource[]> {
  const staged: StagedLocalSource[] = [];
  const total = manifest.sources.filter((source) => source.localId).length;
  try {
    for (const source of manifest.sources) {
      if (!source.localId) continue;
      onProgress?.(staged.length + 1, total);
      // The caller's map is a fast path, not the only path: a render claimed
      // from a freshly opened request page has no React state behind it, so
      // fall back to the on-device index (and, failing that, to the stored file
      // itself) before deciding the original is gone.
      const descriptor =
        descriptorsByLocalId.get(source.localId) ??
        (await descriptorForLocalId(source.localId));
      if (!descriptor) {
        throw new Error(
          `This phone no longer has the original for ${source.localId}. Re-select it to render here.`
        );
      }
      const file = await readLocalMaterial(descriptor);
      const result = await stageLocalSourceForNative(file);
      staged.push({ key: source.assetId, sourceUrl: result.sourceUrl });
    }
    return staged;
  } catch (error) {
    await releaseStagedSources(staged);
    throw error;
  }
}

export async function releaseStagedSources(staged: StagedLocalSource[]): Promise<void> {
  await Promise.allSettled(
    staged.map((source) => releaseStagedLocalSource(source.sourceUrl))
  );
}

/**
 * Render one manifest stage natively.
 *
 * Staged sources are released as soon as the render returns, whether it
 * succeeded or not — they are copies, and leaving them in the plugin's cache is
 * how a phone with a full disk gets fuller.
 */
/**
 * A native render that failed, with what the phone knows about why: the root
 * cause as one sentence (`message`) and every step it took (`log`) — see
 * `RenderErrorLog.java` / `ManifestJob.swift`. An older app build sends no
 * log; the message is then Media3's or AVFoundation's own.
 */
export class NativeRenderError extends Error {
  readonly log: string[];
  constructor(message: string, log: string[]) {
    super(message);
    this.name = "NativeRenderError";
    this.log = log;
  }
}

function nativeFailure(error: unknown): Error {
  const data = (error as { data?: { diagnosis?: unknown; log?: unknown } } | null)?.data;
  const log = Array.isArray(data?.log)
    ? data!.log.filter((line): line is string => typeof line === "string")
    : [];
  const message =
    (typeof data?.diagnosis === "string" && data.diagnosis) ||
    (error instanceof Error ? error.message : String(error));
  return new NativeRenderError(message, log);
}

export async function renderManifestOnDevice(
  manifest: DeviceRenderManifest,
  staged: StagedLocalSource[]
): Promise<NativeManifestResult> {
  if (!Capacitor.isNativePlatform() || !(await supportsManifestRender())) {
    throw new Error("This app build cannot render a video on this phone yet.");
  }
  try {
    return await NativeRenderer.renderManifest({
      manifest: JSON.stringify(manifest),
      stagedSources: staged,
    });
  } catch (error) {
    throw nativeFailure(error);
  } finally {
    await releaseStagedSources(staged);
  }
}

/** Upload a rendered file to the presigned part URLs the server minted. */
export async function uploadRenderedOutput(input: {
  path: string;
  partUrls: string[];
  partSizeBytes: number;
  coverPath?: string | null;
  coverUrl?: string | null;
}): Promise<NativeUploadPart[]> {
  const { parts } = await NativeRenderer.uploadOutput({
    path: input.path,
    partUrls: input.partUrls,
    partSizeBytes: input.partSizeBytes,
    ...(input.coverPath ? { coverPath: input.coverPath } : {}),
    ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
  });
  return parts;
}

export async function cancelDeviceRender(): Promise<void> {
  await NativeRenderer.cancel().catch(() => undefined);
}

export async function releaseRenderedOutput(path: string): Promise<void> {
  await NativeRenderer.releaseOutput({ path }).catch(() => undefined);
}

/** Subscribe to render and upload progress as separate streams. */
export async function observeManifestProgress(listeners: {
  onRender?: (percent: number) => void;
  onUpload?: (percent: number) => void;
}): Promise<() => Promise<void>> {
  const handles: PluginListenerHandle[] = [];
  if (listeners.onRender) {
    handles.push(
      await NativeRenderer.addListener("renderProgress", ({ percent }) =>
        listeners.onRender?.(percent)
      )
    );
  }
  if (listeners.onUpload) {
    handles.push(
      await NativeRenderer.addListener("uploadProgress", ({ percent }) =>
        listeners.onUpload?.(percent)
      )
    );
  }
  return async () => {
    await Promise.allSettled(handles.map((handle) => handle.remove()));
  };
}
