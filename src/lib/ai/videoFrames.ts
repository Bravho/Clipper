import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { AI_CONFIG } from "@/config/aiTools";

/**
 * Sample a few still frames from a video clip so the AI vision steps can "see"
 * a clip's content WITHOUT being sent the whole video.
 *
 * Sending the full MP4 inline costs ~263 tokens/second (a 45s clip ≈ 11.8k
 * tokens) and can exceed Gemini's inline request size limit. A handful of
 * downscaled JPEG frames convey the same visual information for ~258 tokens
 * each. Frame count scales with clip length:
 *   - ≤15s  → 1 frame
 *   - ≤30s  → 2 frames
 *   - >30s  → 3 frames
 *
 * Pure helpers (`framesForDuration`, `frameTimestamps`) are unit-tested without
 * ffmpeg; `extractVideoFrames` shells out to ffmpeg/ffprobe and is exercised
 * end-to-end locally.
 */

const execFileAsync = promisify(execFile);

/** Longest-edge cap for extracted frames — ~1 Gemini image tile (258 tokens). */
const FRAME_MAX_DIMENSION = 768;

/** How many frames to sample for a clip of the given length. */
export function framesForDuration(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  if (seconds <= 15) return 1;
  if (seconds <= 30) return 2;
  return 3;
}

/**
 * Evenly-spaced sample timestamps (seconds) for a clip, biased away from the
 * very start/end (first frames are often black, last frames often a hard cut).
 * For N frames the positions are at (i+1)/(N+1) of the duration:
 *   1 frame  → [midpoint]
 *   2 frames → [1/3, 2/3]
 *   3 frames → [1/4, 2/4, 3/4]
 * Falls back to a single frame at 0s when the duration is unknown.
 */
export function frameTimestamps(seconds: number): number[] {
  const count = framesForDuration(seconds);
  const duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (duration <= 0) return [0];
  return Array.from({ length: count }, (_, i) =>
    Math.round(((i + 1) / (count + 1)) * duration * 1000) / 1000
  );
}

/** Derive the ffprobe path from the configured ffmpeg path. */
function ffprobePathFrom(ffmpegPath: string): string {
  return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) =>
    m.toLowerCase().endsWith(".exe") ? "ffprobe.exe" : "ffprobe"
  );
}

async function probeDurationSeconds(ffmpegPath: string, file: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(ffprobePathFrom(ffmpegPath), [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

export interface InlineFrame {
  /** Base64-encoded JPEG bytes. */
  data: string;
  mimeType: "image/jpeg";
}

/**
 * Extract duration-scaled sample frames from a video buffer and return them as
 * base64 JPEG parts (downscaled to {@link FRAME_MAX_DIMENSION}). Returns an
 * empty array if ffmpeg is unavailable or every frame grab fails, so the caller
 * can decide how to fall back (rather than throwing and killing the AI step).
 */
export async function extractVideoFrames(buffer: Buffer): Promise<InlineFrame[]> {
  const ffmpegPath = AI_CONFIG.ffmpeg.path ?? "ffmpeg";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clipper-frames-"));
  const input = path.join(tmpDir, "clip.mp4");
  try {
    await fs.writeFile(input, buffer);
    const duration = await probeDurationSeconds(ffmpegPath, input);
    const stamps = frameTimestamps(duration);

    const frames: InlineFrame[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const out = path.join(tmpDir, `frame-${i}.jpg`);
      try {
        await execFileAsync(ffmpegPath, [
          "-ss", String(stamps[i]),
          "-i", input,
          "-frames:v", "1",
          // Downscale so the longest edge is <= FRAME_MAX_DIMENSION; the comma
          // inside min() is escaped so ffmpeg doesn't read it as a filter break.
          "-vf", `scale=min(${FRAME_MAX_DIMENSION}\\,iw):-2`,
          "-q:v", "3",
          "-y", out,
        ]);
        const data = await fs.readFile(out);
        frames.push({ data: data.toString("base64"), mimeType: "image/jpeg" });
      } catch (err) {
        console.error(`[videoFrames] frame ${i} at ${stamps[i]}s failed:`, err);
      }
    }
    return frames;
  } catch (err) {
    console.error("[videoFrames] extraction failed:", err);
    return [];
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
