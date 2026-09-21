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
  beginLocalSource(): Promise<void>;
  appendLocalSource(input: { dataBase64: string }): Promise<void>;
  finishLocalSource(): Promise<{ sourceUrl: string; fileSizeBytes: number }>;
  abortLocalSource(): Promise<void>;
  releaseLocalSource(input: { sourceUrl: string }): Promise<void>;
  /** First native primitive: encode one already-composed master to a local MP4. */
  renderMaster(input: { sourceUrl: string }): Promise<{ path: string; fileSizeBytes: number }>;
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
  await NativeRenderer.beginLocalSource();
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

export async function observeDeviceRenderProgress(
  listener: (percent: number) => void
): Promise<PluginListenerHandle> {
  return NativeRenderer.addListener("renderProgress", ({ percent }) => listener(percent));
}

export async function releaseDeviceRenderOutput(path: string): Promise<void> {
  await NativeRenderer.releaseOutput({ path });
}
