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
   * When set, also render a dedicated export for the Travy App using this
   * (always English + Chinese) subtitle content, separate from the general
   * export's `assSubtitlesContent`. Result is returned under the "tvent" key
   * in `exports`. The export uses `tventRatio` (the primary channel's ratio).
   */
  assSubtitlesContentTvent?: string;
  /**
   * Aspect ratio for the dedicated Travy App export — the primary channel's
   * ratio (so Travy matches the primary, not a forced 9:16). Defaults to "9:16".
   */
  tventRatio?: VideoRatio;
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

/** Fallback compose duration when the voice track can't be probed. */
export const DEFAULT_COMPOSE_DURATION_SECONDS = 15;
/** Background-music bed level (pre-ducking), 0..1. */
export const MUSIC_BED_VOLUME = 0.3;
/**
 * Short music-only lead-in before the voiceover starts, so the clip opens with
 * the background track for a beat before narration. The voice is delayed by
 * this amount and the export duration is extended to match (no voice clipped).
 */
export const MUSIC_LEAD_IN_SECONDS = 0.6;

/**
 * Clamp a probed audio/video duration to a sane positive value, falling back
 * to {@link DEFAULT_COMPOSE_DURATION_SECONDS} when the probe failed (<= 0 / NaN).
 */
export function resolveComposeDuration(probedSeconds: number | undefined): number {
  return probedSeconds !== undefined && Number.isFinite(probedSeconds) && probedSeconds > 0
    ? probedSeconds
    : DEFAULT_COMPOSE_DURATION_SECONDS;
}

/**
 * Build the `filter_complex` audio chain that mixes a looping background-music
 * bed under the voiceover with sidechain ducking, so the music drops under
 * speech and recovers in the gaps.
 *
 * `durationSeconds` should be the MEASURED voice/video length (Phase 6) — the
 * music is looped then trimmed to that length so it covers the whole clip
 * instead of the old hardcoded 15s window. Returns the filter strings to be
 * joined into `filter_complex`; the final mix is exposed as `[aout]`.
 */
export function buildMusicMixFilters(params: {
  voiceInputIdx?: number;
  musicInputIdx: number;
  durationSeconds: number;
  musicVolume?: number;
  leadInSeconds?: number;
}): string[] {
  const voiceIdx = params.voiceInputIdx ?? 1;
  const leadIn = params.leadInSeconds ?? MUSIC_LEAD_IN_SECONDS;
  // The voice is delayed by the lead-in, so the looped music must cover the
  // voice length PLUS the lead-in to run under the whole clip.
  const totalDur = (resolveComposeDuration(params.durationSeconds) + leadIn).toFixed(3);
  const leadMs = Math.round(leadIn * 1000);
  const vol = params.musicVolume ?? MUSIC_BED_VOLUME;
  return [
    // Delay the (loudness-normalised) voice by the lead-in so the clip opens on
    // music alone; the delayed copy also keys the sidechain, so ducking only
    // kicks in once the voice actually starts.
    `[${voiceIdx}:a]loudnorm=I=-16:LRA=11:TP=-1.5,adelay=${leadMs}:all=1,asplit=2[sc][voice]`,
    `[${params.musicInputIdx}:a]aloop=-1:size=2147483647,atrim=0:${totalDur},asetpts=PTS-STARTPTS,volume=${vol}[music]`,
    // Gentle, quick-recover ducking (Phase 6): a fast attack drops the music
    // promptly when speech starts and a fast release (300ms) lets it return
    // between sentences. ratio=4 keeps the bed clearly audible UNDER speech
    // (was ratio=8, which dropped it too far) while narration stays on top.
    `[music][sc]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=300[music_ducked]`,
    `[voice][music_ducked]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[aout]`,
  ];
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
  durationSeconds?: number;
}): Promise<void> {
  const { videoPath, audioPath, subsPath, isAss, ratio, outputPath, musicPath, coordinates, overlayPath } = params;
  const ffmpeg = AI_CONFIG.ffmpeg.path;
  const composeDuration = resolveComposeDuration(params.durationSeconds);

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

  // With music we add a short music-only lead-in (the voice is delayed), which
  // extends the clip by the lead-in. Freeze the base's last frame past the end
  // so the (now-delayed) voice tail is never clipped by `-shortest`.
  const hasMusic = musicInputIdx >= 0;
  const leadIn = hasMusic ? MUSIC_LEAD_IN_SECONDS : 0;
  const outputDuration = composeDuration + leadIn;

  const filters: string[] = [];
  const videoTail = leadIn > 0 ? `,tpad=stop_mode=clone:stop_duration=${(leadIn + 1).toFixed(3)}` : "";
  filters.push(`[0:v]${cropAndScaleFilter}${subtitleFilter}${videoTail}[base]`);
  let videoOut = "[base]";

  if (overlayInputIdx >= 0) {
    filters.push(`[${overlayInputIdx}:v]format=yuva420p[ovl]`);
    filters.push(`[base][ovl]overlay=0:0:format=auto,format=yuv420p[vout]`);
    videoOut = "[vout]";
  }

  let audioOut = "1:a";
  if (musicInputIdx >= 0) {
    filters.push(
      ...buildMusicMixFilters({
        musicInputIdx,
        durationSeconds: composeDuration,
        leadInSeconds: leadIn,
      })
    );
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
    // Cap to the measured voice length + music lead-in (Phase 6) instead of a
    // hardcoded 15s — longer clips aren't truncated, shorter ones aren't padded.
    "-t", outputDuration.toFixed(3),
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
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  if (inputStorageKeys.length === 0) {
    throw new Error("concatVideos: at least one input storage key is required");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-concat-"));
  try {
    if (inputStorageKeys.length === 1) {
      const single = path.join(tmpDir, "single.mp4");
      await downloadFromSpaces(inputStorageKeys[0], single);
      await uploadToSpaces(single, outputStorageKey);
      const { size } = await fs.stat(single);
      return {
        storageKey: outputStorageKey,
        storageUrl: spacesPublicUrl(outputStorageKey),
        fileSizeBytes: size,
      };
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
    const { size } = await fs.stat(outPath);
    return {
      storageKey: outputStorageKey,
      storageUrl: spacesPublicUrl(outputStorageKey),
      fileSizeBytes: size,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/** Probe a local media file's duration (seconds) via ffprobe. 0 on failure. */
async function probeDurationSeconds(filePath: string): Promise<number> {
  const ffmpeg = AI_CONFIG.ffmpeg.path ?? "ffmpeg";
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) =>
    m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"
  );
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

/**
 * Phase 7 — composite a transparent subtitle/motion-graphic overlay ON TOP of an
 * already-finished master clip (the merged voice+music export for one ratio),
 * WITHOUT re-cropping or re-mixing. The master's video is the base layer and its
 * audio is stream-copied through untouched (`-c:a copy`), so what ships is the
 * exact master the requester approved, plus the captions/graphics on top.
 *
 * The overlay (`overlayStorageKey`) is the alpha-channel `.webm` produced by
 * `remotionService.renderOverlay` at the SAME ratio's dimensions; `scale2ref`
 * defensively matches it to the master frame in case of any off-by-pixel drift.
 *
 * Returns the stored captioned clip (a NEW key — the master is left intact).
 */
export async function overlayOnMaster(params: {
  masterStorageKey: string;
  overlayStorageKey: string;
  outputStorageKey: string;
}): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  const { masterStorageKey, overlayStorageKey, outputStorageKey } = params;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-overlay-"));
  try {
    const ffmpeg = AI_CONFIG.ffmpeg.path;
    const masterPath = path.join(tmpDir, "master.mp4");
    const overlayPath = path.join(tmpDir, "overlay.webm");
    const outPath = path.join(tmpDir, "out.mp4");

    await Promise.all([
      downloadFromSpaces(masterStorageKey, masterPath),
      downloadFromSpaces(overlayStorageKey, overlayPath),
    ]);

    await execFileAsync(ffmpeg, [
      "-y",
      "-i", masterPath,
      "-i", overlayPath,
      // Alpha-composite the transparent overlay onto the master. The overlay is
      // rendered at the SAME ratio dimensions as the master, so no scaling is
      // needed — we drop the old `scale2ref` hop (it was stripping the alpha
      // plane, which made the overlay opaque and blacked out the video). We
      // force the overlay into a packed-alpha format first so `overlay` honors
      // its transparency.
      "-filter_complex",
      "[1:v]format=yuva420p[ov];[0:v][ov]overlay=format=auto:shortest=1[v]",
      "-map", "[v]",
      // Copy the master's audio (voice + ducked music) through untouched.
      "-map", "0:a?",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outPath,
    ]);

    await uploadToSpaces(outPath, outputStorageKey);
    const { size } = await fs.stat(outPath);
    return {
      storageKey: outputStorageKey,
      storageUrl: spacesPublicUrl(outputStorageKey),
      fileSizeBytes: size,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Concatenate per-scene montage segments with a short cross-dissolve at each
 * scene join (ffmpeg `xfade`), so scene boundaries dissolve like the within-scene
 * cuts instead of hard-switching.
 *
 * `xfade` overlaps each join by `fadeSeconds`, which shortens the result by
 * `fadeSeconds*(n-1)`. The downstream compose step muxes the voiceover with
 * `-shortest`, and the animation/overlay duration is keyed off the measured
 * voice length (NOT this base), so we freeze the final frame for a short pad to
 * guarantee the base outlasts the voice — the voice is never clipped, and only
 * the frozen frames beyond the voice (which compose drops) are added.
 *
 * Falls back to a hard-cut concat (`concatVideos`) if probing or the xfade
 * filtergraph fails, so the pipeline always produces a base video.
 */
export async function concatVideosWithCrossfade(
  inputStorageKeys: string[],
  outputStorageKey: string,
  fadeSeconds = 0.2
): Promise<{ storageKey: string; storageUrl: string; fileSizeBytes: number }> {
  if (inputStorageKeys.length <= 1) {
    return concatVideos(inputStorageKeys, outputStorageKey);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-xfade-"));
  try {
    const ffmpeg = AI_CONFIG.ffmpeg.path;
    const inputPaths: string[] = [];
    for (let i = 0; i < inputStorageKeys.length; i++) {
      const dest = path.join(tmpDir, `in-${i}.mp4`);
      await downloadFromSpaces(inputStorageKeys[i], dest);
      inputPaths.push(dest);
    }

    const durations = await Promise.all(inputPaths.map((p) => probeDurationSeconds(p)));
    if (durations.some((d) => d <= 0)) {
      throw new Error("xfade concat: could not probe one or more segment durations");
    }

    // Never dissolve longer than half of the shortest segment.
    const fade = Math.max(0.05, Math.min(fadeSeconds, ...durations.map((d) => d / 2)));

    const inputArgs: string[] = [];
    inputPaths.forEach((p) => inputArgs.push("-i", p));

    // Chain xfade pairwise. offset for join k = (running accumulated duration) - fade.
    const filters: string[] = [];
    let prevLabel = "0:v";
    let accDuration = durations[0];
    for (let i = 1; i < inputPaths.length; i++) {
      const offset = Math.max(0, accDuration - fade);
      const outLabel = i === inputPaths.length - 1 ? "vxf" : `vx${i}`;
      filters.push(
        `[${prevLabel}][${i}:v]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      prevLabel = outLabel;
      accDuration = accDuration + durations[i] - fade;
    }
    // Freeze the final frame so the base reliably outlasts the voiceover.
    const padSeconds = fade * (inputPaths.length - 1) + 1;
    filters.push(
      `[${prevLabel}]tpad=stop_mode=clone:stop_duration=${padSeconds.toFixed(3)},format=yuv420p,fps=30[vout]`
    );

    const outPath = path.join(tmpDir, "xfade-out.mp4");
    await execFileAsync(ffmpeg, [
      "-y",
      ...inputArgs,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-an",
      outPath,
    ]);

    await uploadToSpaces(outPath, outputStorageKey);
    const { size } = await fs.stat(outPath);
    return {
      storageKey: outputStorageKey,
      storageUrl: spacesPublicUrl(outputStorageKey),
      fileSizeBytes: size,
    };
  } catch (err) {
    console.error("[ffmpeg] crossfade concat failed, falling back to hard-cut concat:", err);
    return concatVideos(inputStorageKeys, outputStorageKey);
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

    const musicPath = params.musicTrackId
      ? path.join(process.cwd(), "public", "music", `${params.musicTrackId}.mp3`)
      : undefined;

    await Promise.all([
      downloadFromSpaces(params.videoStorageKey, videoPath),
      downloadFromSpaces(params.audioStorageKey, audioPath),
    ]);

    // Phase 6: probe the real voice length so the export duration + music bed
    // are dynamic (no hardcoded 15s window).
    const composeDuration = resolveComposeDuration(await probeDurationSeconds(audioPath));

    // Burned-in subtitles are deferred to Phase 7 (accurate timestamp/timeline
    // alignment). For now we only burn captions if the caller explicitly passes
    // ASS content; otherwise no subtitles are rendered.
    let subsPath: string | undefined;
    if (params.assSubtitlesContent) {
      subsPath = path.join(tmpDir, "subs.ass");
      await fs.writeFile(subsPath, params.assSubtitlesContent, "utf-8");
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
          durationSeconds: composeDuration,
        });

        const storageKey = buildFinalClipKey(params.userId, params.requestId, ratio);
        await uploadToSpaces(outPath, storageKey);
        results[ratio] = { storageKey, storageUrl: spacesPublicUrl(storageKey) };
      })
    );

    // Dedicated Travy App export at the PRIMARY channel's ratio. If that ratio's
    // Remotion overlay already covers Travy's fixed English+Chinese subtitle
    // requirement (`overlayCoversTventSubtitles`), reuse that overlay instead of
    // burning `assSubtitlesContentTvent` via ASS. Otherwise, only run an extra
    // ASS-based pass when its subtitle content actually differs from the general
    // export — avoids a redundant FFmpeg pass when the requester also chose EN+ZH.
    const tventRatio: VideoRatio = params.tventRatio ?? "9:16";
    if (overlayPaths[tventRatio] && params.overlayCoversTventSubtitles) {
      const outPath = path.join(tmpDir, "out-tvent.mp4");
      await composeSingleRatio({
        videoPath,
        audioPath,
        ratio: tventRatio,
        outputPath: outPath,
        musicPath,
        coordinates: params.coordinates,
        overlayPath: overlayPaths[tventRatio],
        durationSeconds: composeDuration,
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
        ratio: tventRatio,
        outputPath: outPath,
        musicPath,
        coordinates: params.coordinates,
        durationSeconds: composeDuration,
        // Don't reuse the general overlay here — its captions may not be EN+ZH,
        // and burning both ASS + overlay captions would duplicate text.
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
