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

const RATIO_DIMENSIONS: Record<VideoRatio, { width: number; height: number }> = {
  "9:16":  { width: 1080, height: 1920 },
  "16:9":  { width: 1920, height: 1080 },
  "1:1":   { width: 1080, height: 1080 },
  "4:5":   { width: 1080, height: 1350 },
};

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

/** Run FFmpeg to compose video + audio (+ optional background music with ducking) and export to one ratio. */
async function composeSingleRatio(params: {
  videoPath: string;
  audioPath: string;
  subsPath: string;
  isAss: boolean;
  ratio: VideoRatio;
  outputPath: string;
  musicPath?: string;
  coordinates?: ImageCoordinates;
}): Promise<void> {
  const { videoPath, audioPath, subsPath, isAss, ratio, outputPath, musicPath, coordinates } = params;
  const ffmpeg = AI_CONFIG.ffmpeg.path;

  const cropAndScaleFilter = getSmartCropFilter(ratio, coordinates);
  
  // Format subtitle filter parameter (ASS formatting uses font style defined inside the .ass file)
  const subtitleFilter = isAss
    ? `subtitles=${subsPath.replace(/\\/g, "/")}`
    : `subtitles=${subsPath.replace(/\\/g, "/")}:force_style='Fontsize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=2'`;

  const videoFilter = `${cropAndScaleFilter},${subtitleFilter}`;

  if (!musicPath) {
    await execFileAsync(ffmpeg, [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-vf", videoFilter,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-ar", "48000",
      "-shortest",
      "-t", "15",
      outputPath,
    ]);
    return;
  }

  // With background music ducking (autoduck sidechain):
  const audioFilterComplex = [
    "[1:a]loudnorm=I=-16:LRA=11:TP=-1.5,asplit=2[sc][voice]",
    "[2:a]aloop=-1:size=2147483647,atrim=0:15,asetpts=PTS-STARTPTS,volume=0.3[music]",
    "[music][sc]sidechaincompress=threshold=0.02:ratio=8:attack=80:release=1500[music_ducked]",
    "[voice][music_ducked]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[out]",
  ].join(";");

  await execFileAsync(ffmpeg, [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-i", musicPath,
    "-filter_complex", audioFilterComplex,
    "-map", "0:v:0",
    "-map", "[out]",
    "-vf", videoFilter,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-ar", "48000",
    "-shortest",
    "-t", "15",
    outputPath,
  ]);
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
        });

        const storageKey = buildFinalClipKey(params.userId, params.requestId, ratio);
        await uploadToSpaces(outPath, storageKey);
        results[ratio] = { storageKey, storageUrl: spacesPublicUrl(storageKey) };
      })
    );

    return { exports: results };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
