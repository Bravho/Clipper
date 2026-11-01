import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { ProductDetector } from './ProductDetector';
import type { ProductDetection } from '@/domain/models/AssetVisualAnalysis';
import { visualConfig } from '@/config/storyboardVisual';

const MODEL_SHA256 = 'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d';
const INPUT_SIZE = 416;
const STRIDES: readonly number[] = [8, 16, 32];
// Grid sizes for 416px input: 416/8=52, 416/16=26, 416/32=13
const GRID_SIZES = STRIDES.map(s => INPUT_SIZE / s);
// Anchor counts per stride group: 52²=2704, 26²=676, 13²=169 → total 3549
const ANCHOR_COUNTS = GRID_SIZES.map(g => g * g);
const IOU_THRESHOLD = 0.45;
const NUM_CLASSES = 80;

/**
 * Class policy: accept all 80 COCO classes by default.
 * "product" = highest-confidence object box from the general detector.
 * Override by setting STORYBOARD_YOLOX_CLASS_ALLOWLIST to a comma-separated
 * list of COCO class indices (0-based). Shop-relevant examples:
 *   39=bottle, 40=wine glass, 41=cup, 45=bowl,
 *   46=banana, 47=apple, 48=sandwich, 49=orange, 50=broccoli,
 *   51=carrot, 52=hot dog, 53=pizza, 54=donut, 55=cake,
 *   75=vase, 77=teddy bear
 */
function allowedClasses(): Set<number> | null {
  const val = process.env.STORYBOARD_YOLOX_CLASS_ALLOWLIST?.trim();
  if (!val) return null; // null = accept all
  return new Set(val.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite));
}

interface Detection {
  x: number; y: number; w: number; h: number; // top-left, normalized [0,1]
  confidence: number;
}

type OrtTensor = { data: Float32Array };
type OrtSession = { run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>> };
export type SessionFactory = (modelPath: string) => Promise<OrtSession>;

async function defaultSessionFactory(modelPath: string): Promise<OrtSession> {
  // Dynamic import keeps onnxruntime-node out of Next.js bundles and avoids
  // loading the native module in processes that never use this detector.
  const ortMod: unknown = await import('onnxruntime-node');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ort: any = (ortMod as any).default ?? ortMod;
  return ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
}

export class YoloxNanoDetector implements ProductDetector {
  private sessionPromise: Promise<OrtSession> | null = null;
  private readonly modelPath: string;
  private readonly sessionFactory: SessionFactory;
  private readonly verify: boolean;

  /**
   * @param sessionFactory - Injectable for tests; replaces real onnxruntime-node session.
   * @param verify - Set false in unit tests to skip the filesystem SHA256 check.
   */
  constructor(sessionFactory?: SessionFactory, verify = true) {
    this.modelPath =
      process.env.STORYBOARD_YOLOX_MODEL_PATH ??
      path.join(process.cwd(), 'models', 'yolox', 'yolox_nano.onnx');
    this.sessionFactory = sessionFactory ?? defaultSessionFactory;
    this.verify = verify;
  }

  private getSession(): Promise<OrtSession> {
    if (!this.sessionPromise) this.sessionPromise = this.loadSession();
    return this.sessionPromise;
  }

  private async loadSession(): Promise<OrtSession> {
    if (this.verify) {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(this.modelPath);
      } catch (err) {
        throw new Error(
          `YoloxNanoDetector: cannot read model at "${this.modelPath}": ${err}`,
        );
      }
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      if (hash !== MODEL_SHA256) {
        throw new Error(
          `YoloxNanoDetector: SHA256 mismatch for "${this.modelPath}".\n` +
          `  expected: ${MODEL_SHA256}\n  got:      ${hash}`,
        );
      }
    }
    return this.sessionFactory(this.modelPath);
  }

  async detect(frames: Buffer[]): Promise<(ProductDetection | null)[]> {
    // Session loading (including SHA256 check) throws intentionally on error.
    // Per-frame inference errors are caught individually.
    const session = await this.getSession();
    const minConf = visualConfig().confidence;
    return Promise.all(
      frames.map(f => this.detectOne(session, f, minConf).catch(() => null)),
    );
  }

  private async detectOne(
    session: OrtSession,
    frame: Buffer,
    minConf: number,
  ): Promise<ProductDetection | null> {
    // Decode source dimensions and preprocess with sharp.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharpMod: any = await import('sharp');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sharpFn: (buf: Buffer) => any = sharpMod.default ?? sharpMod;

    const meta: { width?: number; height?: number } = await sharpFn(frame).metadata();
    const srcW = meta.width ?? INPUT_SIZE;
    const srcH = meta.height ?? INPUT_SIZE;

    const scale = Math.min(INPUT_SIZE / srcW, INPUT_SIZE / srcH);
    const newW = Math.round(srcW * scale);
    const newH = Math.round(srcH * scale);

    // Resize maintaining aspect ratio; raw RGB output.
    const rawRgb: Buffer = await sharpFn(frame)
      .resize(newW, newH, { fit: 'fill' })
      .raw()
      .toBuffer();

    // Build CHW float32 tensor in BGR order, letter-box padding = 114.0.
    // The official YOLOX ONNX export expects raw 0-255 BGR, no mean/std.
    const size = INPUT_SIZE * INPUT_SIZE;
    const tensorData = new Float32Array(3 * size).fill(114);
    for (let row = 0; row < newH; row++) {
      for (let col = 0; col < newW; col++) {
        const si = (row * newW + col) * 3;
        const di = row * INPUT_SIZE + col;
        tensorData[di]              = rawRgb[si + 2]; // B
        tensorData[size + di]       = rawRgb[si + 1]; // G
        tensorData[2 * size + di]   = rawRgb[si + 0]; // R
      }
    }

    // Create input tensor and run (ort imported lazily after sharp succeeds).
    const ortMod: unknown = await import('onnxruntime-node');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ort: any = (ortMod as any).default ?? ortMod;
    const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const out: Record<string, OrtTensor> = await session.run({ images: inputTensor });
    const outputData = out['output'].data;

    const dets = decodeDetections(outputData, scale, srcW, srcH, allowedClasses());
    const filtered = dets.filter(d => d.confidence >= minConf);
    if (!filtered.length) return null;

    const best = nmsTop(filtered);
    if (!best) return null;

    return {
      box: {
        x: Math.max(0, Math.min(1, best.x)),
        y: Math.max(0, Math.min(1, best.y)),
        w: Math.max(0, Math.min(1, best.w)),
        h: Math.max(0, Math.min(1, best.h)),
      },
      confidence: Math.max(0, Math.min(1, best.confidence)),
    };
  }
}

/**
 * Decode YOLOX raw output [3549, 85] into normalized source-frame detections.
 *
 * YOLOX ONNX convention (verified against YOLOX demo/ONNXRuntime/onnx_inference.py):
 *   - obj_conf and cls_scores are already sigmoid'd inside the ONNX graph.
 *   - Box regression: x=(px+gx)*s, y=(py+gy)*s, w=exp(pw)*s, h=exp(ph)*s.
 *   - Stride groups in order: 8 (52×52), 16 (26×26), 32 (13×13).
 */
function decodeDetections(
  data: Float32Array,
  scale: number,
  srcW: number,
  srcH: number,
  allowed: Set<number> | null,
): Detection[] {
  const dets: Detection[] = [];
  let rowOffset = 0;

  for (let si = 0; si < STRIDES.length; si++) {
    const stride = STRIDES[si];
    const gs = GRID_SIZES[si];
    const count = ANCHOR_COUNTS[si];

    for (let i = 0; i < count; i++) {
      const base = (rowOffset + i) * 85;
      const objConf = data[base + 4];
      if (objConf < 0.01) continue; // fast reject

      let bestCls = 0;
      let bestScore = data[base + 5];
      for (let c = 1; c < NUM_CLASSES; c++) {
        const s = data[base + 5 + c];
        if (s > bestScore) { bestScore = s; bestCls = c; }
      }

      if (allowed !== null && !allowed.has(bestCls)) continue;

      const conf = objConf * bestScore;
      if (conf < 0.01) continue;

      const gx = i % gs;
      const gy = Math.floor(i / gs);

      // Decode box from letterboxed 416px space to source-frame pixels.
      const cx = (data[base + 0] + gx) * stride / scale;
      const cy = (data[base + 1] + gy) * stride / scale;
      const bw = Math.exp(Math.min(data[base + 2], 50)) * stride / scale;
      const bh = Math.exp(Math.min(data[base + 3], 50)) * stride / scale;

      dets.push({
        x: (cx - bw / 2) / srcW,
        y: (cy - bh / 2) / srcH,
        w: bw / srcW,
        h: bh / srcH,
        confidence: conf,
      });
    }

    rowOffset += count;
  }

  return dets;
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter === 0 ? 0 : inter / (a.w * a.h + b.w * b.h - inter);
}

function nmsTop(detections: Detection[]): Detection | null {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (!suppressed.has(j) && iou(sorted[i], sorted[j]) > IOU_THRESHOLD) {
        suppressed.add(j);
      }
    }
  }
  return kept[0] ?? null;
}
