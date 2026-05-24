import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { buildFinalClipKey } from "@/lib/spacesKeys";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const execFileAsync = promisify(execFile);

type VideoRatio = "9:16" | "16:9" | "1:1" | "4:5";

const RATIO_DIMENSIONS: Record<VideoRatio, { width: number; height: number }> = {
  "9:16":  { width: 1080, height: 1920 },
  "16:9":  { width: 1920, height: 1080 },
  "1:1":   { width: 1080, height: 1080 },
  "4:5":   { width: 1080, height: 1350 },
};

export interface ComposeVideoParams {
  videoStorageKey: string;
  audioStorageKey: string;
  scriptThai: string;
  scriptEnglish: string;
  hookThai: string;
  userId: string;
  requestId: string;
}

export interface ComposeVideoResult {
  exports: Record<VideoRatio, { storageKey: string; storageUrl: string }>;
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

/** Estimate timing for an SRT segment based on word count. */
function estimateTiming(
  wordCount: number,
  totalWords: number,
  totalDurationMs: number,
  startMs: number
): { start: number; end: number } {
  const fraction = wordCount / totalWords;
  const duration = totalDurationMs * fraction;
  return { start: startMs, end: startMs + duration };
}

function msToSrtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ms2 = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(ms2).padStart(3, "0")}`;
}

/**
 * Build bilingual SRT subtitle file.
 * Thai on one line, English below it — combined as one subtitle entry.
 * The hook occupies the first 3 seconds with emphasis markers.
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

  // Hook subtitle (0–3s)
  lines.push(
    `${index++}`,
    `${msToSrtTime(0)} --> ${msToSrtTime(HOOK_MS)}`,
    `${hookThai}`,
    ``,
    ``
  );

  // Main body (3–15s) — split into ~3 segments
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

/** Run FFmpeg to compose video + audio + subtitles and export to one ratio. */
async function composeSingleRatio(
  videoPath: string,
  audioPath: string,
  srtPath: string,
  ratio: VideoRatio,
  outputPath: string
): Promise<void> {
  const { width, height } = RATIO_DIMENSIONS[ratio];
  const ffmpeg = AI_CONFIG.ffmpeg.path;

  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  const subtitleFilter = `subtitles=${srtPath.replace(/\\/g, "/")}:force_style='Fontsize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=2'`;

  await execFileAsync(ffmpeg, [
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",   // video stream from Kling AI clip (input 0)
    "-map", "1:a:0",   // audio stream from RVC WAV (input 1) — explicit, never picks video's own audio
    "-vf", `${scaleFilter},${subtitleFilter}`,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-ar", "48000",    // pin output to 48 kHz to match RVC WAV — no surprise resampling
    "-shortest",
    "-t", "15",
    outputPath,
  ]);
}

/**
 * Compose final video with audio and bilingual subtitles, then export
 * in all 4 platform ratios. Returns DO Spaces keys per ratio.
 */
export async function composeAndExport(
  params: ComposeVideoParams
): Promise<ComposeVideoResult> {
  const tmpDir = path.join(os.tmpdir(), `clipper-${params.requestId}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const videoPath = path.join(tmpDir, "base.mp4");
    const audioPath = path.join(tmpDir, "voice.wav"); // RVC outputs 48 kHz WAV — keep correct extension
    const srtPath = path.join(tmpDir, "subs.srt");

    await Promise.all([
      downloadFromSpaces(params.videoStorageKey, videoPath),
      downloadFromSpaces(params.audioStorageKey, audioPath),
    ]);

    await buildBilingualSrt(
      params.scriptThai,
      params.scriptEnglish,
      params.hookThai,
      srtPath
    );

    const ratios: VideoRatio[] = ["9:16", "16:9", "1:1", "4:5"];
    const results: ComposeVideoResult["exports"] = {} as ComposeVideoResult["exports"];

    await Promise.all(
      ratios.map(async (ratio) => {
        const outPath = path.join(tmpDir, `out-${ratio.replace(":", "-")}.mp4`);
        await composeSingleRatio(videoPath, audioPath, srtPath, ratio, outPath);

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
