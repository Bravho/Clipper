"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { readLocalMaterial } from "@/features/requests/localMediaStore";
import type { LocalMediaDescriptor } from "@/lib/mobile/localMediaContract";

export interface NativeRenderCapabilities {
  nativePluginVersion: number;
  freeBytes: number;
  supportsH264Encode: boolean;
  supportsAacEncode: boolean;
}

interface DeviceVideoRenderPlugin {
  capabilities(): Promise<NativeRenderCapabilities>;
  beginLocalSource(input: { extension: string }): Promise<void>;
  appendLocalSource(input: { dataBase64: string }): Promise<void>;
  finishLocalSource(): Promise<{ sourceUrl: string; fileSizeBytes: number }>;
  abortLocalSource(): Promise<void>;
  releaseLocalSource(input: { sourceUrl: string }): Promise<void>;
  /** First native primitive: encode one already-composed master to a local MP4. */
  renderMaster(input: { sourceUrl: string }): Promise<{ path: string; fileSizeBytes: number }>;
  renderLocalTimeline(input: {
    clips: { sourceUrl: string; startSeconds: number; durationSeconds: number }[];
    width: number;
    height: number;
  }): Promise<{ path: string; fileSizeBytes: number }>;
  renderAudioDraft(input: {
    masterPath: string;
    voiceUrl: string;
    musicUrl?: string;
  }): Promise<{ path: string; fileSizeBytes: number }>;
  /** v6: a light 720p H.264 copy of a staged clip, for in-app preview only. */
  makePreviewProxy(input: { sourceUrl: string }): Promise<{ path: string; fileSizeBytes: number }>;
  cancel(): Promise<void>;
  releaseOutput(input: { path: string }): Promise<void>;
  addListener(eventName: "renderProgress", listener: (event: { percent: number }) => void): Promise<PluginListenerHandle>;
}

const NativeRenderer = registerPlugin<DeviceVideoRenderPlugin>("DeviceVideoRender");

export async function getNativeRenderCapabilities(): Promise<NativeRenderCapabilities | null> {
  // The web UI is served remotely, so an old installed binary may load new JS.
  // Missing native support must be a normal fallback, never a fatal call.
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("DeviceVideoRender")) {
    return null;
  }
  try {
    const capabilities = await NativeRenderer.capabilities();
    return capabilities.nativePluginVersion >= 1 ? capabilities : null;
  } catch {
    return null;
  }
}

export async function renderMasterOnDevice(sourceUrl: string): Promise<{
  path: string;
  fileSizeBytes: number;
}> {
  if (!(await getNativeRenderCapabilities())) {
    throw new Error("This app build cannot render video on this device");
  }
  return NativeRenderer.renderMaster({ sourceUrl });
}

const NATIVE_SOURCE_CHUNK_BYTES = 2 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

/** Copy one private WebView file into native cache without using the network. */
export async function stageLocalSourceForNative(file: File): Promise<{
  sourceUrl: string;
  fileSizeBytes: number;
}> {
  const capabilities = await getNativeRenderCapabilities();
  if (!capabilities || capabilities.nativePluginVersion < 2) {
    throw new Error("This app build cannot stage local media for rendering");
  }
  const extension = file.type === "audio/mpeg" ? "mp3"
    : file.type === "audio/wav" || file.type === "audio/x-wav" ? "wav"
    : file.type === "audio/mp4" || file.type === "audio/x-m4a" ? "m4a"
    : file.type === "video/mp4" ? "mp4" : "bin";
  await NativeRenderer.beginLocalSource({ extension });
  let result: { sourceUrl: string; fileSizeBytes: number };
  try {
    for (let offset = 0; offset < file.size; offset += NATIVE_SOURCE_CHUNK_BYTES) {
      const bytes = new Uint8Array(
        await file.slice(offset, Math.min(file.size, offset + NATIVE_SOURCE_CHUNK_BYTES)).arrayBuffer()
      );
      await NativeRenderer.appendLocalSource({ dataBase64: bytesToBase64(bytes) });
    }
    result = await NativeRenderer.finishLocalSource();
  } catch (error) {
    await NativeRenderer.abortLocalSource().catch(() => undefined);
    throw error;
  }
  if (result.fileSizeBytes !== file.size) {
    await NativeRenderer.releaseLocalSource({ sourceUrl: result.sourceUrl }).catch(() => undefined);
    throw new Error("Local media staging produced an incomplete file");
  }
  return result;
}

export async function releaseStagedLocalSource(sourceUrl: string): Promise<void> {
  await NativeRenderer.releaseLocalSource({ sourceUrl });
}

/** Render a single local clip, releasing its native staging copy afterward. */
export async function renderLocalClipOnDevice(descriptor: LocalMediaDescriptor): Promise<{
  path: string;
  fileSizeBytes: number;
}> {
  const staged = await stageLocalSourceForNative(await readLocalMaterial(descriptor));
  try {
    return await renderMasterOnDevice(staged.sourceUrl);
  } finally {
    await releaseStagedLocalSource(staged.sourceUrl).catch(() => undefined);
  }
}

/** Join actual local video tracks on iOS or Android, preserving their moving frames. */
export async function renderLocalVideoTimelineOnDevice(
  clips: { descriptor: LocalMediaDescriptor; startSeconds: number; durationSeconds: number }[],
  width: number,
  height: number
): Promise<{ path: string; fileSizeBytes: number }> {
  const files = await Promise.all(clips.map(async (clip) => ({
    file: await readLocalMaterial(clip.descriptor),
    startSeconds: clip.startSeconds,
    durationSeconds: clip.durationSeconds,
  })));
  return renderVideoFilesOnDevice(files, width, height);
}

/** Used by local storage and by the development-only device render screen. */
export async function renderVideoFilesOnDevice(
  clips: { file: File; startSeconds: number; durationSeconds: number }[],
  width: number,
  height: number
): Promise<{ path: string; fileSizeBytes: number }> {
  const capabilities = await getNativeRenderCapabilities();
  if (!Capacitor.isNativePlatform() || !capabilities || capabilities.nativePluginVersion < 3) {
    throw new Error("This app build cannot compose local video clips");
  }
  if (clips.length < 1 || clips.length > 10 ||
      !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 1920 || height > 1920) {
    throw new Error("Invalid local video timeline");
  }
  const staged: string[] = [];
  try {
    const nativeClips = [];
    for (const clip of clips) {
      if (!clip.file.type.startsWith("video/") ||
          !Number.isFinite(clip.startSeconds) || clip.startSeconds < 0 ||
          !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) {
        throw new Error("The local timeline requires real video clips and valid trims");
      }
      const source = await stageLocalSourceForNative(clip.file);
      staged.push(source.sourceUrl);
      nativeClips.push({
        sourceUrl: source.sourceUrl,
        startSeconds: clip.startSeconds,
        durationSeconds: clip.durationSeconds,
      });
    }
    return await NativeRenderer.renderLocalTimeline({ clips: nativeClips, width, height });
  } finally {
    await Promise.allSettled(staged.map((sourceUrl) => releaseStagedLocalSource(sourceUrl)));
  }
}

export async function observeDeviceRenderProgress(
  listener: (percent: number) => void
): Promise<PluginListenerHandle> {
  return NativeRenderer.addListener("renderProgress", ({ percent }) => listener(percent));
}

export async function releaseDeviceRenderOutput(path: string): Promise<void> {
  await NativeRenderer.releaseOutput({ path });
}

/** Local audible draft; approved voice/music job wiring is a separate server step. */
export async function renderAudioDraftOnDevice(
  masterPath: string,
  voiceFile: File,
  musicFile?: File
): Promise<{ path: string; fileSizeBytes: number }> {
  const capabilities = await getNativeRenderCapabilities();
  if (!capabilities || capabilities.nativePluginVersion < 4 || !capabilities.supportsAacEncode) {
    throw new Error("This app build cannot mix local voice and music");
  }
  if (!voiceFile.type.startsWith("audio/") ||
      (musicFile && !musicFile.type.startsWith("audio/"))) {
    throw new Error("Choose audio files for the speaking voice and music");
  }
  const staged: string[] = [];
  try {
    const voice = await stageLocalSourceForNative(voiceFile);
    staged.push(voice.sourceUrl);
    const music = musicFile ? await stageLocalSourceForNative(musicFile) : null;
    if (music) staged.push(music.sourceUrl);
    return await NativeRenderer.renderAudioDraft({
      masterPath,
      voiceUrl: voice.sourceUrl,
      ...(music ? { musicUrl: music.sourceUrl } : {}),
    });
  } finally {
    await Promise.allSettled(staged.map((sourceUrl) => releaseStagedLocalSource(sourceUrl)));
  }
}

/** The plugin version that can make a preview copy (`makePreviewProxy`). */
const PREVIEW_PROXY_PLUGIN_VERSION = 6;

/**
 * Make a light, WebView-playable copy of a clip the in-app browser cannot
 * decode (HEVC, 10-bit HDR, 4K60 …) using the phone's own video engine.
 *
 * For the PREVIEW only: the returned file feeds the storyboard and trimmer,
 * and is never submitted or rendered — the original is. Returns null on an
 * app build that cannot do this, so the caller can explain instead.
 */
export async function makePreviewProxyOnDevice(file: File): Promise<File | null> {
  const capabilities = await getNativeRenderCapabilities();
  if (!capabilities || capabilities.nativePluginVersion < PREVIEW_PROXY_PLUGIN_VERSION) {
    return null;
  }
  const staged = await stageLocalSourceForNative(file);
  try {
    const result = await NativeRenderer.makePreviewProxy({ sourceUrl: staged.sourceUrl });
    try {
      const response = await fetch(Capacitor.convertFileSrc(result.path));
      if (!response.ok) throw new Error("The preview copy could not be read back");
      const blob = await response.blob();
      const base = file.name.replace(/\.[^.]+$/, "");
      return new File([blob], `${base}-preview.mp4`, { type: "video/mp4" });
    } finally {
      await NativeRenderer.releaseOutput({ path: result.path }).catch(() => undefined);
    }
  } finally {
    await releaseStagedLocalSource(staged.sourceUrl).catch(() => undefined);
  }
}
