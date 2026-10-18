"use client";

import { Share } from "@capacitor/share";
import {
  observeManifestProgress,
  releaseRenderedOutput,
  renderManifestOnDevice,
  saveVideoToPhoneGallery,
  type GallerySaveResult,
  type StagedLocalSource,
} from "@/lib/mobile/deviceRenderBridge";
import {
  getNativeRenderCapabilities,
  releaseStagedLocalSource,
  stageLocalSourceForNative,
} from "@/lib/mobile/deviceVideoRender";
import { canRenderFromSources } from "@/lib/mobile/deviceRenderPluginVersion";
import { finishedVideoUri, keepFinishedVideo, shareableCopy } from "@/lib/mobile/finishedVideoCache";
import { CAMPAIGN_CLIP_ASSET_ID, NATIVE_VOICE_KEY } from "@/lib/campaigns/campaignConstants";
import type { DeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";

/**
 * Render the Merchant Quick Video with the EXISTING phone renderer.
 *
 * This is the studio's own path, reused: stage the original into the plugin's
 * cache (`stageLocalSourceForNative`), `renderManifest` it, keep the result in
 * the finished-video cache. Nothing is uploaded and no render attempt, task or
 * queue entry is created on the server.
 *
 * Clip sound: the same staged file is also handed over under the reserved
 * "voice" key, so the renderer's mixer takes the audio from the clip itself.
 * If that fails (a phone that cannot read audio from its camera's file), the
 * render runs again WITHOUT it and the phone downloads the manifest's
 * `voiceUrl` — a music track — instead.
 */

/** Can this app build make the quick video? (plugin v6: compose from originals) */
export async function canMakeCampaignVideo(): Promise<boolean> {
  const capabilities = await getNativeRenderCapabilities();
  return Boolean(
    capabilities &&
      canRenderFromSources(capabilities.nativePluginVersion) &&
      capabilities.supportsH264Encode &&
      capabilities.supportsAacEncode
  );
}

export interface CampaignRenderResult {
  /** Key of the kept video in the finished-video cache. */
  videoKey: string;
  /** True when the clip's own sound could not be used and music was used. */
  soundFallback: boolean;
}

async function renderOnce(
  manifest: DeviceRenderManifest,
  file: File,
  withClipSound: boolean
) {
  const staged = await stageLocalSourceForNative(file);
  const sources: StagedLocalSource[] = [{ key: CAMPAIGN_CLIP_ASSET_ID, sourceUrl: staged.sourceUrl }];
  if (withClipSound) sources.push({ key: NATIVE_VOICE_KEY, sourceUrl: staged.sourceUrl });
  try {
    // Releases the staged copy (both keys point at it) when it returns.
    return await renderManifestOnDevice(manifest, sources);
  } finally {
    await releaseStagedLocalSource(staged.sourceUrl).catch(() => undefined);
  }
}

export async function renderCampaignVideo(input: {
  manifest: DeviceRenderManifest;
  file: File;
  useClipSound: boolean;
  videoKey: string;
  onProgress?: (percent: number) => void;
}): Promise<CampaignRenderResult> {
  const stop = await observeManifestProgress({
    onRender: (percent) => input.onProgress?.(Math.max(0, Math.min(100, Math.round(percent)))),
  });
  try {
    let soundFallback = false;
    let result;
    try {
      result = await renderOnce(input.manifest, input.file, input.useClipSound);
    } catch (error) {
      if (!input.useClipSound) throw error;
      soundFallback = true;
      input.onProgress?.(0);
      result = await renderOnce(input.manifest, input.file, false);
    }
    await keepFinishedVideo(input.videoKey, result.path);
    await releaseRenderedOutput(result.path);
    if (result.coverPath) await releaseRenderedOutput(result.coverPath);
    if (!(await finishedVideoUri(input.videoKey))) {
      throw new Error("The finished video could not be kept on this phone.");
    }
    return { videoKey: input.videoKey, soundFallback };
  } finally {
    await stop();
  }
}

/** The native share sheet (Facebook, Instagram, LINE, …) — the user posts. */
export async function shareCampaignVideo(videoKey: string, fileName: string): Promise<void> {
  const uri = (await shareableCopy(videoKey, fileName)) ?? (await finishedVideoUri(videoKey));
  if (!uri) throw new Error("The video is no longer on this phone.");
  await Share.share({ title: fileName, url: uri, dialogTitle: fileName });
}

/** Photos on iOS, Movies/RClipper on Android; the share sheet on older builds. */
export async function saveCampaignVideo(
  videoKey: string,
  fileName: string
): Promise<GallerySaveResult | null> {
  const uri = await finishedVideoUri(videoKey);
  if (!uri) throw new Error("The video is no longer on this phone.");
  const saved = await saveVideoToPhoneGallery(uri, fileName);
  if (saved) return saved;
  await shareCampaignVideo(videoKey, fileName);
  return null;
}
