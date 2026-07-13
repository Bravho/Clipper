import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { spacesClient, spacesPublicUrl, spacesSendWithRetry } from "@/lib/spaces";
import { AI_CONFIG } from "@/config/aiTools";
import type { TimedSegment } from "@/lib/ai/geminiSubtitlesService";
import type { AnimationSpec } from "@/lib/ai/animationService";
import type { ScenePlan } from "@/domain/models/VideoGenerationJob";
import type { VideoRatio } from "@/lib/ai/ffmpegService";
import type { Palette } from "@/lib/ai/paletteService";
import { getRemotionBundle } from "@/lib/ai/remotionBundle";

/**
 * Phase 4 — Remotion-based motion-graphics/caption overlay rendering.
 *
 * Renders one transparent (alpha-channel, VP8/yuva420p WebM) overlay clip
 * per required aspect ratio, using the `remotion/` project at the repo
 * root (composition id "Overlay" — see `remotion/Root.tsx`). The overlay
 * contains kinetic captions (from `voiceTimestamps`/`subtitleTimeline`) and
 * scene motion-graphics (from `animationSpecs`, produced by
 * `animationService.generateAnimationSpec`).
 *
 * `_runAnimationGeneration` (VideoGenerationService) calls `renderOverlay`
 * once per ratio returned by `ffmpegService.getRequiredRatiosForPlatforms`
 * and stores the resulting asset IDs on `job.animatedOverlayAssetIds`.
 * `_runFFmpegComposition` later composites each overlay onto the
 * corresponding cropped/scaled base video via `ffmpegService.overlayVideo`
 * / `composeSingleRatio`.
 *
 * Render failures should be treated like other AI-step failures: caught by
 * the caller, recorded via `failedAtStep = GeneratingAnimations`, and
 * retryable via `retryPipeline()` / `regenerateAnimationByRequester()`.
 */

const RENDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per ratio — generous for headless Chromium cold starts

const execFileAsync = promisify(execFile);

/**
 * Remux an MP4 in place so the `moov` atom sits at the FRONT (`+faststart`).
 * Without this the browser cannot read the clip's total duration until it has
 * buffered the whole file, so the player shows no total time / a stuck scrubber
 * on first load. Stream-copy only (no re-encode). Best-effort: on any failure the
 * original file is left untouched.
 */
async function faststartRemux(mp4Path: string): Promise<void> {
  const ffmpeg = AI_CONFIG.ffmpeg.path ?? "ffmpeg";
  const tmpOut = `${mp4Path}.faststart.mp4`;
  try {
    await execFileAsync(ffmpeg, [
      "-y",
      "-i", mp4Path,
      "-c", "copy",
      "-movflags", "+faststart",
      tmpOut,
    ]);
    await fs.rename(tmpOut, mp4Path);
  } catch (err) {
    console.error("[remotion] faststart remux failed, using original output:", err);
    await fs.rm(tmpOut, { force: true }).catch(() => {});
  }
}

export interface RenderOverlayParams {
  ratio: VideoRatio;
  /** Real voice/video duration in seconds (from `job.voiceDurationSeconds`). */
  durationSeconds: number;
  /** Per-sentence timing for kinetic captions (`job.voiceTimestamps`/`subtitleTimeline`, parsed). */
  subtitleTimeline: TimedSegment[];
  /** Languages to render as burned-in captions on this overlay. */
  subtitleLanguages: ("th" | "en" | "zh")[];
  /** Approved scene plan — passed through for future scene-transition templates. */
  scenePlan: ScenePlan[];
  /** Motion-graphics overlay specs from `animationService.generateAnimationSpec`. */
  animationSpecs: AnimationSpec[];
  /** Brand/content palette for the decorative shape layer. */
  palette: Palette;
  /** DO Spaces key the rendered `.webm` overlay clip will be uploaded to. */
  outputStorageKey: string;
}

/**
 * Renders one transparent overlay clip and uploads it to DO Spaces.
 * Returns the asset's public URL (caller is responsible for creating the
 * corresponding `UploadedAsset` record).
 */
export async function renderOverlay(params: RenderOverlayParams): Promise<string> {
  const {
    ratio,
    durationSeconds,
    subtitleTimeline,
    subtitleLanguages,
    scenePlan,
    animationSpecs,
    palette,
    outputStorageKey,
  } = params;

  const inputProps = {
    ratio,
    durationSeconds,
    subtitleTimeline,
    subtitleLanguages,
    scenePlan: scenePlan.map((s) => ({
      sceneNumber: s.sceneNumber,
      durationSeconds: s.durationSeconds,
      visualDescriptionThai: s.visualDescriptionThai,
      imageIndexes: s.imageIndexes,
    })),
    animationSpecs,
    palette,
  };

  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const serveUrl = await getRemotionBundle();

  const composition = await selectComposition({
    serveUrl,
    id: "Overlay",
    inputProps,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-remotion-"));
  const outputPath = path.join(tmpDir, "overlay.webm");

  try {
    await renderMedia({
      composition,
      serveUrl,
      // VP9 (not VP8) for the alpha WebM: FFmpeg decodes VP9 `yuva420p` alpha
      // reliably, whereas the VP8 alpha plane was being dropped to black at
      // composite time (the "black video behind the captions" bug).
      codec: "vp9",
      pixelFormat: "yuva420p",
      // Transparent (alpha) output requires PNG frames — the default JPEG image
      // format cannot carry an alpha channel and Remotion rejects the combo.
      imageFormat: "png",
      outputLocation: outputPath,
      inputProps,
      timeoutInMilliseconds: RENDER_TIMEOUT_MS,
    });

    const data = await fs.readFile(outputPath);
    const bucket = process.env.DO_SPACES_BUCKET!;
    // Retry: DO Spaces intermittently 400s ("UnknownError") a healthy upload.
    // A single unretried send failing was killing the whole overlay step.
    await spacesSendWithRetry(`upload overlay ${outputStorageKey}`, () =>
      spacesClient.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: outputStorageKey,
          Body: data,
          ContentType: "video/webm",
          ACL: "public-read",
        })
      )
    );
    return spacesPublicUrl(outputStorageKey);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export interface RenderTemplatedVideoParams {
  /** Public URL of the merged (voice+music) master for this ratio. */
  masterUrl: string;
  ratio: VideoRatio;
  durationSeconds: number;
  templateId: string;
  palette: Palette;
  subtitleTimeline: TimedSegment[];
  subtitleLanguages: ("th" | "en" | "zh")[];
  /** DO Spaces key the rendered `.mp4` will be uploaded to. */
  outputStorageKey: string;
}

/**
 * Phase 7 (template redesign) — render the final styled/captioned video in a
 * SINGLE Remotion pass: the master plays inside the composition (audio carried
 * through OffthreadVideo) with the template frame/decor + subtitles on top,
 * output as an opaque H.264 MP4. No alpha compositing (this is what fixes the
 * black-video bug). Returns the stored clip.
 */
export async function renderTemplatedVideo(
  params: RenderTemplatedVideoParams
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  const inputProps = {
    masterUrl: params.masterUrl,
    ratio: params.ratio,
    durationSeconds: params.durationSeconds,
    templateId: params.templateId,
    palette: params.palette,
    subtitleTimeline: params.subtitleTimeline,
    subtitleLanguages: params.subtitleLanguages,
  };

  const { selectComposition, renderMedia } = await import("@remotion/renderer");
  const serveUrl = await getRemotionBundle();

  const composition = await selectComposition({
    serveUrl,
    id: "TemplatedVideo",
    inputProps,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-templated-"));
  const outputPath = path.join(tmpDir, "styled.mp4");

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      pixelFormat: "yuv420p",
      outputLocation: outputPath,
      inputProps,
      timeoutInMilliseconds: RENDER_TIMEOUT_MS,
    });

    // Move the moov atom to the front so the player shows the total duration on
    // first load (matching the montage/base-video card behavior).
    await faststartRemux(outputPath);

    const data = await fs.readFile(outputPath);
    const bucket = process.env.DO_SPACES_BUCKET!;
    // Retry: DO Spaces intermittently 400s ("UnknownError") a healthy upload.
    // This is the `overlay_composition` step's final upload — an unretried send
    // failing here was what stalled the pipeline at "generating_overlay".
    await spacesSendWithRetry(`upload styled ${params.outputStorageKey}`, () =>
      spacesClient.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: params.outputStorageKey,
          Body: data,
          ContentType: "video/mp4",
          ACL: "public-read",
        })
      )
    );
    return {
      storageKey: params.outputStorageKey,
      storageUrl: spacesPublicUrl(params.outputStorageKey),
      fileSizeBytes: data.length,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
