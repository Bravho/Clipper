import { spawn } from 'child_process';
import { AI_CONFIG } from '@/config/aiTools';
import { probeMediaSummary } from './ffmpegService';
import type { AssetVisualAnalysis, ProductDetection } from '@/domain/models/AssetVisualAnalysis';
import type { ProductDetector } from './ProductDetector';
import { visualConfig } from '@/config/storyboardVisual';

export type VisualRunner = (args: string[], input?: Buffer) => Promise<{ stdout: Buffer; stderr: string }>;
/** Same binary resolution as ffmpegService/videoFrames; no shell interpolation. */
export const runVisualFfmpeg: VisualRunner = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(AI_CONFIG.ffmpeg.path ?? 'ffmpeg', args, { windowsHide: true });
  const out: Buffer[] = []; const err: Buffer[] = []; let size = 0;
  const timer = setTimeout(() => child.kill(), 120000);
  child.stdout.on('data', (b: Buffer) => { size += b.length; if (size > 16 * 1024 * 1024) child.kill(); else out.push(b); });
  child.stderr.on('data', (b: Buffer) => { if (err.reduce((n, x) => n + x.length, 0) < 4 * 1024 * 1024) err.push(b); });
  child.on('error', e => { clearTimeout(timer); reject(e); });
  child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }) : reject(new Error('visual_ffmpeg_failed')); });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
});
export function cropMetrics(box: ProductDetection['box'], width: number, height: number) {
  const cw = Math.min(1, height * 9 / 16 / width);
  const ch = Math.min(1, width * 16 / 9 / height);
  const left = (1 - cw) / 2, top = (1 - ch) / 2;
  const x = Math.max(left, box.x), y = Math.max(top, box.y);
  const w = Math.max(0, Math.min(left + cw, box.x + box.w) - x);
  const h = Math.max(0, Math.min(top + ch, box.y + box.h) - y);
  return { centerOffset: Math.hypot((box.x + box.w / 2 - 0.5) / cw, (box.y + box.h / 2 - 0.5) / ch), areaRatio: w * h / (cw * ch) };
}
export function parseSceneCuts(stderr: string): number[] {
  return [...new Set([...stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1])))].filter(t => t > 0).sort((a,b) => a-b);
}
export async function analyseVisualMedia(assetId: string, input: string, photo: boolean, detector: ProductDetector,
  run: VisualRunner = runVisualFfmpeg, probe = probeMediaSummary): Promise<AssetVisualAnalysis> {
  const cfg = visualConfig();
  const media = await probe(input);
  const width = media.displayWidth ?? 0, height = media.displayHeight ?? 0;
  if (width <= 0 || height <= 0 || (!photo && media.durationSeconds <= 0)) throw new Error('visual_probe_failed');
  const usableDuration = photo ? cfg.maxDuration : Math.min(cfg.maxDuration, media.durationSeconds);
  const stamps = photo ? [0] : [0.25, 0.5, 0.75].map(f => f * usableDuration);
  const frames = [];
  for (const time of stamps) {
    const { stdout } = await run(['-v','error','-ss',String(time),'-i',input,'-frames:v','1','-vf',"scale=320:320:force_original_aspect_ratio=decrease",'-f','image2pipe','-vcodec','mjpeg','pipe:1']);
    frames.push({ time, bytes: stdout });
  }
  const detections = await detector.detect(frames.map(f => f.bytes));
  let cuts: number[] = [];
  if (!photo) {
    const result = await run(['-i',input,'-t',String(usableDuration),'-vf',`select='gt(scene,${cfg.sceneThreshold})',showinfo`,'-an','-f','null','-']);
    cuts = parseSceneCuts(result.stderr).filter(t => t < usableDuration);
  }
  return { assetId, version: cfg.version, usableDuration, width, height, photo, cuts,
    frames: frames.map((f,i) => {
      const raw = detections[i];
      const d = raw && [raw.box.x,raw.box.y,raw.box.w,raw.box.h,raw.confidence].every(Number.isFinite) && raw.box.x >= 0 && raw.box.y >= 0 && raw.box.w > 0 && raw.box.h > 0 && raw.box.x + raw.box.w <= 1 && raw.box.y + raw.box.h <= 1 && raw.confidence >= 0 && raw.confidence <= 1 ? raw : null;
      return { data: f.bytes.toString('base64'), time: f.time, detection: d,
        ...(d ? cropMetrics(d.box, width, height) : { centerOffset: null, areaRatio: null }) };
    }) };
}
/** One <=384px JPEG total, not one image per shot; fixed cost estimate 258 tokens. Null-data frames are skipped. */
export async function visualContactSheet(frames: Array<string | null>, run: VisualRunner = runVisualFfmpeg): Promise<string> {
  const valid = frames.filter((f): f is string => f !== null);
  if (!valid.length) throw new Error('visual_frames_missing');
  const count = valid.length, columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns), cell = Math.floor(384 / columns / 2) * 2;
  const { stdout } = await run(['-f','image2pipe','-vcodec','mjpeg','-i','pipe:0','-vf',`scale=${cell}:${cell}:force_original_aspect_ratio=decrease,pad=${cell}:${cell}:(ow-iw)/2:(oh-ih)/2,tile=${columns}x${rows}:nb_frames=${count}`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'], Buffer.concat(valid.map(f => Buffer.from(f,'base64'))));
  return stdout.toString('base64');
}
