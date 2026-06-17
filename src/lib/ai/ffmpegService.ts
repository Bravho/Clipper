import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { buildFinalClipKey } from "@/lib/spacesKeys";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ImageCoordinates } from "./geminiSubtitlesService";

const execFileAsync = promisify(execFile);

export type VideoRatio = "9:16" | "16:9" | "1:1" | "4:5";

export function getRequiredRatiosForPlatforms(platforms: string[]): VideoRatio[] {
  const ratios = new Set<VideoRatio>();
  for (const p of platforms) {
    if (p === "tiktok" || p === "tvent_app") {
      ratios.add("9:16");
    } else if (p === "youtube" || p === "facebook" || p === "cdn") {
      ratios.add("16:9");
    } else if (p === "instagram") {
      ratios.add("4:5");
      ratios.add("1:1");
    }
  }
  if (ratios.size === 0) {
    ratios.add("9:16");
  }
  return Array.from(ratios);
}


export interface ComposeVideoParams {
  videoStorageKey: string;
  audioStorageKey: string;
  scriptThai: string;
  scriptEnglish: string;
  hookThai: string;
  userId: string;
  requestId: string;
  musicTrackId?: string;
  coordinates?: ImageCoordinates;
  targetRatios?: VideoRatio[];
  assSubtitlesContent?: string;
  /**
   * When set, also render a dedicated 9:16 export for the Tvent App using
   * this (always English + Chinese) subtitle content, separate from the
   * general 9:16 export's `assSubtitlesContent`. Result is returned under
   * the "tvent" key in `exports`.
   */
  assSubtitlesContentTvent?: string;
  /**
   * Phase 4 — Remotion-rendered transparent overlay clip (captions +
   * motion graphics) per ratio, keyed by `VideoRatio`. When present for a
   * given ratio, that ratio's export composites this overlay on top of the
   * cropped/scaled base video via FFmpeg's `overlay` filter, and the
   * ASS/SRT subtitle burn-in is SKIPPED for that ratio (the overlay's
   * `CaptionOverlay` already covers `subtitleLanguages`).
   */
  overlayStorageKeys?: Partial<Record<VideoRatio, string>>;
  /**
   * Set when `overlayStorageKeys["9:16"]`'s captions were rendered with
   * exactly English + Chinese (matching the Tvent App's fixed subtitle
   * requirement). If true, the Tvent export reuses that 9:16 overlay
   * instead of burning `assSubtitlesContentTvent` via ASS.
   */
  overlayCoversTventSubtitles?: boolean;
}

export interface ComposeVideoResult {
  exports: Record<string, { storageKey: string; storageUrl: string }>;
}

async function downloadFromSpaces(storageKey: string, destPath: string): Promise<void> {
  const bucket = process.env.DO_SPACES_BUCKET!;
  const res = await spacesClient.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  await fs.writeFile(destPath, Buffer.concat(chunks));
}

async function uploadToSpaces(
  filePath: string,
  storageKey: string
): Promise<void> {
  const buffer = await fs.readFile(filePath);
  await spacesClient.send(
    new PutObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET!,
      Key: storageKey,
      Body: buffer,
      ContentType: "video/mp4",
      ACL: "public-read",
    })
  );
}

/**
 * Builds standard SRT file if ASS content is not provided (fallback).
 */
async function buildBilingualSrt(
  scriptThai: string,
  scriptEnglish: string,
  hookThai: string,
  outputPath: string
): Promise<void> {
  const TOTAL_MS = 15_000;
  const HOOK_MS = 3_000;

  const lines: string[] = [];
  let index = 1;

  function msToSrtTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const ms2 = Math.floor(ms % 1000);
    return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(ms2).padStart(3, "0")}`;
  }

  // Hook subtitle (0–3s)
  lines.push(
    `${index++}`,
    `${msToSrtTime(0)} --> ${msToSrtTime(HOOK_MS)}`,
    `${hookThai}`,
    ``,
    ``
  );

  const thaiWords = scriptThai.trim().split(/\s+/);
  const engWords = scriptEnglish.trim().split(/\s+/);
  const SEGMENTS = 3;
  const segMs = (TOTAL_MS - HOOK_MS) / SEGMENTS;

  for (let i = 0; i < SEGMENTS; i++) {
    const thaiStart = Math.floor((thaiWords.length / SEGMENTS) * i);
    const thaiEnd = Math.floor((thaiWords.length / SEGMENTS) * (i + 1));
    const engStart = Math.floor((engWords.length / SEGMENTS) * i);
    const engEnd = Math.floor((engWords.length / SEGMENTS) * (i + 1));

    const startMs = HOOK_MS + segMs * i;
    const endMs = HOOK_MS + segMs * (i + 1);

    const thaiLine = thaiWords.slice(thaiStart, thaiEnd).join(" ");
    const engLine = engWords.slice(engStart, engEnd).join(" ");

    lines.push(
      `${index++}`,
      `${msToSrtTime(startMs)} --> ${msToSrtTime(endMs)}`,
      `${thaiLine}`,
      `${engLine}`,
      ``,
      ``
    );
  }

  await fs.writeFile(outputPath, lines.join("\n"), "utf-8");
}

/**
 * Calculates smart crop parameters for cropping a widescreen 1920x1080 video.
 */
function getSmartCropFilter(ratio: VideoRatio, coords?: ImageCoordinates): string {
  const W_base = 1920;
  const H_base = 1080;

  // Compute product center coordinate in pixels
  let xCenter = W_base / 2; // 960
  if (coords && coords.xmin != null && coords.xmax != null) {
    const normCenter = (coords.xmin + coords.xmax) / 2; // 0 to 1000
    xCenter = (normCenter / 1000) * W_base;
  }

  if (ratio === "9:16") {
    const W_crop = Math.round(H_base * (9 / 16)); // 607.5 -> 608
    const H_crop = H_base; // 1080
    let xStart = Math.round(xCenter - W_crop / 2);
    xStart = Math.max(0, Math.min(W_base - W_crop, xStart)); // Clamp between 0 and 1312
    return `crop=${W_crop}:${H_crop}:${xStart}:0,scale=1080:1920`;
  }

  if (ratio === "1:1") {
    const W_crop = H_base; // 1080
    const H_crop = H_base; // 1080
    let xStart = Math.round(xCenter - W_crop / 2);
    xStart = Math.max(0, Math.min(W_base - W_crop, xStart)); // Clamp between 0 and 840
    return `crop=${W_crop}:${H_crop}:${xStart}:0`;
  }

  if (ratio === "4:5") {
    const W_crop = Math.round(H_base * (4 / 5)); // 864
    const H_crop = H_base; // 1080
    let xStart = Math.round(xCenter - W_crop / 2);
    xStart = Math.max(0, Math.min(W_base - W_crop, xStart)); // Clamp between 0 and 1056
    return `crop=${W_crop}:${H_crop}:${xStart}:0,scale=1080:1350`;
  }

  // 16:9 - No cropping needed
  return "scale=1920:1080";
}

/**
 * Run FFmpeg to compose video + audio (+ optional background music with
 * ducking, + optional Phase 4 Remotion overlay clip) and export to one
 * ratio.
 *
 * When `overlayPath` is provided, the ASS/SRT subtitle burn-in (`subsPath`)
 * is skipped — the Remotion overlay's `CaptionOverlay` already covers
 * `subtitleLanguages` for that ratio (see `ComposeVideoParams.overlayStorageKeys`).
 */
async function composeSingleRatio(params: {
  videoPath: string;
  audioPath: string;
  subsPath?: string;
  isAss?: boolean;
  ratio: VideoRatio;
  outputPath: string;
  musicPath?: string;
  coordinates?: ImageCoordinates;
  overlayPath?: string;
}): Promise<void> {
  const { videoPath, audioPath, subsPath, isAss, ratio, outputPath, musicPath, coordinates, overlayPath } = params;
  const ffmpeg = AI_CONFIG.ffmpeg.path;

  const cropAndScaleFilter = getSmartCropFilter(ratio, coordinates);

  // Format subtitle filter parameter (ASS formatting uses font style defined
  // inside the .ass file). Skipped entirely when a Remotion overlay (which
  // already burns captions) is supplied.
  const subtitleFilter =
    !overlayPath && subsPath
      ? "," +
        (isAss
          ? `subtitles=${subsPath.replace(/\\/g, "/")}`
          : `subtitles=${subsPath.replace(/\\/g, "/")}:force_style='Fontsize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=2'`)
      : "";

  const args: string[] = ["-y", "-i", videoPath, "-i", audioPath];
  let nextInput = 2;
  let overlayInputIdx = -1;
  let musicInputIdx = -1;

  if (overlayPath) {
    args.push("-i", overlayPath);
    overlayInputIdx = nextInput++;
  }
  if (musicPath) {
    args.push("-i", musicPath);
    musicInputIdx = nextInput++;
  }

  const filters: string[] = [];
  filters.push(`[0:v]${cropAndScaleFilter}${subtitleFilter}[base]`);
  let videoOut = "[base]";

  if (overlayInputIdx >= 0) {
    filters.push(`[${overlayInputIdx}:v]format=yuva420p[ovl]`);
    filters.push(`[base][ovl]overlay=0:0:format=auto,format=yuv420p[vout]`);
    videoOut = "[vout]";
  }

  let audioOut = "1:a";
  if (musicInputIdx >= 0) {
    filters.push("[1:a]loudnorm=I=-16:LRA=11:TP=-1.5,asplit=2[sc][voice]");
    filters.push(`[${musicInputIdx}:a]aloop=-1:size=2147483647,atrim=0:15,asetpts=PTS-STARTPTS,volume=0.3[music]`);
    filters.push("[music][sc]sidechaincompress=threshold=0.02:ratio=8:attack=80:release=1500[music_ducked]");
    filters.push("[voice][music_ducked]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[aout]");
    audioOut = "[aout]";
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", videoOut);
  args.push("-map", audioOut);
  args.push(
    "-c:v", "libx264",
    "-c:a", "aac",
    "-ar", "48000",
    "-shortest",
    "-t", "15",
    outputPath
  );

  await execFileAsync(ffmpeg, args);
}

/**
 * Composites a Remotion alpha-channel overlay clip onto a base video,
 * cropped/scaled to `ratio`, with no audio re-encoding concerns — used to
 * build the single-ratio "representative preview" shown at
 * `AwaitingAnimationApproval` (`animatedVideoAssetId`). The full per-ratio
 * final exports go through `composeSingleRatio` (with `overlayPath`)
 * instead, which also handles audio/music.
 */
export async function renderOverlayPreview(params: {
  videoStorageKey: string;
  overlayStorageKey: string;
  ratio: VideoRatio;
  outputStorageKey: string;
  coordinates?: ImageCoordinates;
}): Promise<void> {
  const { videoStorageKey, overlayStorageKey, ratio, outputStorageKey, coordinates } = params;
  const ffmpeg = AI_CONFIG.ffmpeg.path;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-overlay-preview-"));
  try {
    const videoPath = path.join(tmpDir, "base.mp4");
    const overlayPath = path.join(tmpDir, "overlay.webm");
    await Promise.all([
      downloadFromSpaces(videoStorageKey, videoPath),
      downloadFromSpaces(overlayStorageKey, overlayPath),
    ]);

    const outPath = path.join(tmpDir, "preview.mp4");
    const cropAndScaleFilter = getSmartCropFilter(ratio, coordinates);

    await execFileAsync(ffmpeg, [
      "-y",
      "-i", videoPath,
      "-i", overlayPath,
      "-filter_complex",
      `[0:v]${cropAndScaleFilter}[base];[1:v]format=yuva420p[ovl];[base][ovl]overlay=0:0:format=auto,format=yuv420p[vout]`,
      "-map", "[vout]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-t", "15",
      outPath,
    ]);

    await uploadToSpaces(outPath, outputStorageKey);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Concatenate multiple video clips (in order) into a single video file using
 * ffmpeg's concat demuxer. Downloads each input from DO Spaces, concatenates
 * with `-c copy` (fast, no re-encode — assumes all clips share the same
 * codec/resolution, which holds for same-model Veo outputs), and uploads
 * the result to `outputStorageKey`.
 *
 * If `-c copy` fails (e.g. mismatched codecs/timestamps across clips), falls
 * back to re-encoding with libx264/aac.
 *
 * If only one storage key is provided, the clip is simply re-uploaded under
 * `outputStorageKey` (no ffmpeg concat needed) so callers can treat the
 * single-scene case uniformly.
 */
export async function concatVideos(
  inputStorageKeys: string[],
  outputStorageKey: string
): Promise<{ storageKey: string; storageUrl: string }> {
  if (inputStorageKeys.length === 0) {
    throw new Error("concatVideos: at least one input storage key is required");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-concat-"));
  try {
    if (inputStorageKeys.length === 1) {
      const single = path.join(tmpDir, "single.mp4");
      await downloadFromSpaces(inputStorageKeys[0], single);
      await uploadToSpaces(single, outputStorageKey);
      return { storageKey: outputStorageKey, storageUrl: spacesPublicUrl(outputStorageKey) };
    }

    const ffmpeg = AI_CONFIG.ffmpeg.path;
    const inputPaths: string[] = [];
    for (let i = 0; i < inputStorageKeys.length; i++) {
      const dest = path.join(tmpDir, `in-${i}.mp4`);
      await downloadFromSpaces(inputStorageKeys[i], dest);
      inputPaths.push(dest);
    }

    const listFile = path.join(tmpDir, "concat.txt");
    const listContent = inputPaths
      .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
      .join("\n");
    await fs.writeFile(listFile, listContent, "utf-8");

    const outPath = path.join(tmpDir, "concat-out.mp4");

    try {
      await execFileAsync(ffmpeg, [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c", "copy",
        outPath,
      ]);
    } catch (err) {
      // Fall back to re-encode if stream copy fails (mismatched codecs/params).
      console.error("[ffmpeg] concat -c copy failed, falling back to re-encode:", err);
      await execFileAsync(ffmpeg, [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c:v", "libx264",
        "-c:a", "aac",
        outPath,
      ]);
    }

    await uploadToSpaces(outPath, outputStorageKey);
    return { storageKey: outputStorageKey, storageUrl: spacesPublicUrl(outputStorageKey) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Compose final video with audio and bilingual subtitles, then export
 * in selected platform ratios. Returns DO Spaces keys per ratio.
 */
export async function composeAndExport(
  params: ComposeVideoParams
): Promise<ComposeVideoResult> {
  const tmpDir = path.join(os.tmpdir(), `clipper-${params.requestId}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const videoPath = path.join(tmpDir, "base.mp4");
    const audioPath = path.join(tmpDir, "voice.wav");
    const subsPath = params.assSubtitlesContent ? path.join(tmpDir, "subs.ass") : path.join(tmpDir, "subs.srt");

    const musicPath = params.musicTrackId
      ? path.join(process.cwd(), "public", "music", `${params.musicTrackId}.mp3`)
      : undefined;

    await Promise.all([
      downloadFromSpaces(params.videoStorageKey, videoPath),
      downloadFromSpaces(params.audioStorageKey, audioPath),
    ]);

    // Build subtitle file (ASS or SRT)
    if (params.assSubtitlesContent) {
      await fs.writeFile(subsPath, params.assSubtitlesContent, "utf-8");
    } else {
      await buildBilingualSrt(
        params.scriptThai,
        params.scriptEnglish,
        params.hookThai,
        subsPath
      );
    }

    const targetRatios = params.targetRatios ?? ["9:16", "16:9", "1:1", "4:5"];
    const results: ComposeVideoResult["exports"] = {};

    // Phase 4: download any Remotion overlay clips up front, keyed by ratio.
    const overlayPaths: Partial<Record<VideoRatio, string>> = {};
    if (params.overlayStorageKeys) {
      await Promise.all(
        Object.entries(params.overlayStorageKeys).map(async ([ratio, key]) => {
          if (!key) return;
          const overlayPath = path.join(tmpDir, `overlay-${ratio.replace(":", "-")}.webm`);
          await downloadFromSpaces(key, overlayPath);
          overlayPaths[ratio as VideoRatio] = overlayPath;
        })
      );
    }

    await Promise.all(
      targetRatios.map(async (ratio) => {
        const outPath = path.join(tmpDir, `out-${ratio.replace(":", "-")}.mp4`);
        await composeSingleRatio({
          videoPath,
          audioPath,
          subsPath,
          isAss: !!params.assSubtitlesContent,
          ratio,
          outputPath: outPath,
          musicPath,
          coordinates: params.coordinates,
          overlayPath: overlayPaths[ratio],
        });

        const storageKey = buildFinalClipKey(params.userId, params.requestId, ratio);
        await uploadToSpaces(outPath, storageKey);
        results[ratio] = { storageKey, storageUrl: spacesPublicUrl(storageKey) };
      })
    );

    // Dedicated Tvent App 9:16 export. If the 9:16 Remotion overlay already
    // covers Tvent's fixed English+Chinese subtitle requirement
    // (`overlayCoversTventSubtitles`), reuse that overlay instead of
    // burning `assSubtitlesContentTvent` via ASS. Otherwise, only run an
    // extra ASS-based pass when its subtitle content actually differs from
    // the general 9:16 export — avoids a redundant FFmpeg pass when the
    // requester also chose English + Chinese.
    if (overlayPaths["9:16"] && params.overlayCoversTventSubtitles) {
      const outPath = path.join(tmpDir, "out-tvent.mp4");
      await composeSingleRatio({
        videoPath,
        audioPath,
        ratio: "9:16",
        outputPath: outPath,
        musicPath,
        coordinates: params.coordinates,
        overlayPath: overlayPaths["9:16"],
      });

      const storageKey = buildFinalClipKey(params.userId, params.requestId, "tvent");
      await uploadToSpaces(outPath, storageKey);
      results["tvent"] = { storageKey, storageUrl: spacesPublicUrl(storageKey) };
    } else if (
      params.assSubtitlesContentTvent &&
      params.assSubtitlesContentTvent !== params.assSubtitlesContent
    ) {
      const tventSubsPath = path.join(tmpDir, "subs-tvent.ass");
      await fs.writeFile(tventSubsPath, params.assSubtitlesContentTvent, "utf-8");

      const outPath = path.join(tmpDir, "out-tvent.mp4");
      await composeSingleRatio({
        videoPath,
        audioPath,
        subsPath: tventSubsPath,
        isAss: true,
        ratio: "9:16",
        outputPath: outPath,
        musicPath,
        coordinates: params.coordinates,
        // Don't reuse the general 9:16 overlay here — its captions may not
        // be EN+ZH, and burning both ASS + overlay captions would duplicate text.
      });

      const storageKey = buildFinalClipKey(params.userId, params.requestId, "tvent");
      await uploadToSpaces(outPath, storageKey);
      results["tvent"] = { storageKey, storageUrl: spacesPublicUrl(storageKey) };
    }

    return { exports: results };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
