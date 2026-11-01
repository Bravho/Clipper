import fs from 'fs';
import os from 'os';
import path from 'path';
import { YoloxNanoDetector, type SessionFactory } from '@/lib/ai/YoloxNanoDetector';
import {
  productDetector,
  NoopProductDetector,
  MockProductDetector,
} from '@/lib/ai/ProductDetector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a solid-color 100×100 JPEG using sharp. */
async function solidJpeg(r = 128, g = 128, b = 128): Promise<Buffer> {
  const sharpMod = await import('sharp');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharp: any = (sharpMod as any).default ?? sharpMod;
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r, g, b } },
  })
    .jpeg()
    .toBuffer();
}

/**
 * Build a synthetic YOLOX output tensor [3549 × 85] with one detection.
 *
 * Row 530 = grid position (gx=10, gy=10) in the stride-8 group (52×52).
 * For a 100×100 source with scale = 4.16:
 *   cx = (0+10)*8 = 80 → cx_src = 80/4.16 ≈ 19.23
 *   cy = (0+10)*8 = 80 → cy_src ≈ 19.23
 *   w  = exp(ln2)*8=16 → w_src  = 16/4.16 ≈ 3.846
 *   h  = exp(ln2)*8=16 → h_src  ≈ 3.846
 *   x_norm = (19.23 - 1.923)/100 ≈ 0.1731
 *   conf   = objConf * clsScore  = 0.9 * 0.9 = 0.81
 */
function syntheticOutput(objConf: number, clsScore: number, classIdx = 0): Float32Array {
  const data = new Float32Array(3549 * 85).fill(0);
  const row = 530; // stride-8, gx=10, gy=10
  const base = row * 85;
  data[base + 0] = 0;              // px
  data[base + 1] = 0;              // py
  data[base + 2] = Math.log(2);   // pw → exp = 2
  data[base + 3] = Math.log(2);   // ph → exp = 2
  data[base + 4] = objConf;
  data[base + 5 + classIdx] = clsScore;
  return data;
}

function makeSession(data: Float32Array): SessionFactory {
  return async () => ({
    run: async () => ({ output: { data } }),
  });
}

// ---------------------------------------------------------------------------
// Unit tests (mocked session, no real model file required)
// ---------------------------------------------------------------------------

describe('YoloxNanoDetector unit tests', () => {
  test('detects a box from synthetic output tensor', async () => {
    const frame = await solidJpeg();
    const detector = new YoloxNanoDetector(makeSession(syntheticOutput(0.9, 0.9)), false);
    const [result] = await detector.detect([frame]);

    expect(result).not.toBeNull();
    expect(result!.confidence).toBeCloseTo(0.81, 3);
    // x_norm ≈ 0.1731
    expect(result!.box.x).toBeCloseTo(0.1731, 2);
    expect(result!.box.y).toBeCloseTo(0.1731, 2);
    // w_norm ≈ 0.03846
    expect(result!.box.w).toBeCloseTo(0.03846, 3);
    expect(result!.box.h).toBeCloseTo(0.03846, 3);
    // All box values in [0,1]
    expect(result!.box.x).toBeGreaterThanOrEqual(0);
    expect(result!.box.y).toBeGreaterThanOrEqual(0);
    expect(result!.box.w).toBeGreaterThan(0);
    expect(result!.box.h).toBeGreaterThan(0);
    expect(result!.box.x + result!.box.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(result!.box.y + result!.box.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  test('returns null when confidence is below threshold (default 0.7)', async () => {
    // confidence = 0.5 * 0.5 = 0.25 < 0.7
    const frame = await solidJpeg();
    const detector = new YoloxNanoDetector(makeSession(syntheticOutput(0.5, 0.5)), false);
    const [result] = await detector.detect([frame]);
    expect(result).toBeNull();
  });

  test('returns null for a corrupt/non-JPEG buffer', async () => {
    const badFrame = Buffer.from('not a jpeg at all');
    const detector = new YoloxNanoDetector(makeSession(syntheticOutput(0.9, 0.9)), false);
    const [result] = await detector.detect([badFrame]);
    expect(result).toBeNull();
  });

  test('returns null for an empty output (no detections)', async () => {
    const frame = await solidJpeg();
    const detector = new YoloxNanoDetector(
      makeSession(new Float32Array(3549 * 85).fill(0)),
      false,
    );
    const [result] = await detector.detect([frame]);
    expect(result).toBeNull();
  });

  test('handles multiple frames, bad frame mid-batch does not abort others', async () => {
    const good = await solidJpeg(200, 150, 100);
    const bad = Buffer.from('garbage');
    const session = makeSession(syntheticOutput(0.9, 0.9));
    const detector = new YoloxNanoDetector(session, false);
    const results = await detector.detect([good, bad, good]);
    expect(results).toHaveLength(3);
    expect(results[0]).not.toBeNull(); // good frame -> detection
    expect(results[1]).toBeNull();      // bad frame -> null, not thrown
    expect(results[2]).not.toBeNull();
  });

  test('respects STORYBOARD_YOLOX_CLASS_ALLOWLIST: filters out non-listed class', async () => {
    process.env.STORYBOARD_YOLOX_CLASS_ALLOWLIST = '39'; // bottle only
    const frame = await solidJpeg();
    // Class 0 (person) — not in allowlist → should return null
    const detector = new YoloxNanoDetector(makeSession(syntheticOutput(0.9, 0.9, 0)), false);
    const [result] = await detector.detect([frame]);
    expect(result).toBeNull();
    delete process.env.STORYBOARD_YOLOX_CLASS_ALLOWLIST;
  });

  test('respects STORYBOARD_YOLOX_CLASS_ALLOWLIST: passes listed class', async () => {
    process.env.STORYBOARD_YOLOX_CLASS_ALLOWLIST = '0,39';
    const frame = await solidJpeg();
    // Class 0 (person) — in allowlist
    const detector = new YoloxNanoDetector(makeSession(syntheticOutput(0.9, 0.9, 0)), false);
    const [result] = await detector.detect([frame]);
    expect(result).not.toBeNull();
    delete process.env.STORYBOARD_YOLOX_CLASS_ALLOWLIST;
  });
});

// ---------------------------------------------------------------------------
// Checksum test
// ---------------------------------------------------------------------------

describe('YoloxNanoDetector SHA256 check', () => {
  test('throws a clear error on SHA256 mismatch', async () => {
    const tmpPath = path.join(os.tmpdir(), 'yolox_bad_model_test.onnx');
    fs.writeFileSync(tmpPath, Buffer.from('not a real onnx model'));

    const originalPath = process.env.STORYBOARD_YOLOX_MODEL_PATH;
    process.env.STORYBOARD_YOLOX_MODEL_PATH = tmpPath;

    const detector = new YoloxNanoDetector(makeSession(new Float32Array(0)));
    // verify=true is the default; should throw before calling the session
    await expect(detector.detect([Buffer.alloc(0)])).rejects.toThrow('SHA256 mismatch');

    if (originalPath === undefined) {
      delete process.env.STORYBOARD_YOLOX_MODEL_PATH;
    } else {
      process.env.STORYBOARD_YOLOX_MODEL_PATH = originalPath;
    }
    fs.unlinkSync(tmpPath);
  });

  test('throws a clear error when model file is missing', async () => {
    const originalPath = process.env.STORYBOARD_YOLOX_MODEL_PATH;
    process.env.STORYBOARD_YOLOX_MODEL_PATH = path.join(os.tmpdir(), 'nonexistent_yolox.onnx');

    const detector = new YoloxNanoDetector(makeSession(new Float32Array(0)));
    await expect(detector.detect([Buffer.alloc(0)])).rejects.toThrow('cannot read model');

    if (originalPath === undefined) {
      delete process.env.STORYBOARD_YOLOX_MODEL_PATH;
    } else {
      process.env.STORYBOARD_YOLOX_MODEL_PATH = originalPath;
    }
  });
});

// ---------------------------------------------------------------------------
// productDetector() selection logic
// ---------------------------------------------------------------------------

describe('productDetector() selection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars modified during tests
    delete process.env.STORYBOARD_PRODUCT_DETECTOR;
    delete process.env.STORYBOARD_AI_PRECHECK_ENABLED;
    delete process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED;
    Object.assign(process.env, originalEnv);
  });

  test('returns NoopProductDetector by default (no env var)', () => {
    delete process.env.STORYBOARD_PRODUCT_DETECTOR;
    delete process.env.STORYBOARD_AI_PRECHECK_ENABLED;
    delete process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED;
    expect(productDetector()).toBeInstanceOf(NoopProductDetector);
  });

  test('returns MockProductDetector when STORYBOARD_PRODUCT_DETECTOR=mock', () => {
    process.env.STORYBOARD_PRODUCT_DETECTOR = 'mock';
    expect(productDetector()).toBeInstanceOf(MockProductDetector);
  });

  test('returns NoopProductDetector for yolox when visual flags are off', () => {
    process.env.STORYBOARD_PRODUCT_DETECTOR = 'yolox';
    delete process.env.STORYBOARD_AI_PRECHECK_ENABLED;
    delete process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED;
    expect(productDetector()).toBeInstanceOf(NoopProductDetector);
  });

  test('returns NoopProductDetector for yolox when only one precheck flag is true', () => {
    process.env.STORYBOARD_PRODUCT_DETECTOR = 'yolox';
    process.env.STORYBOARD_AI_PRECHECK_ENABLED = 'true';
    process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED = 'false';
    expect(productDetector()).toBeInstanceOf(NoopProductDetector);
  });

  test('returns YoloxNanoDetector when yolox + both precheck flags true', () => {
    process.env.STORYBOARD_PRODUCT_DETECTOR = 'yolox';
    process.env.STORYBOARD_AI_PRECHECK_ENABLED = 'true';
    process.env.STORYBOARD_VISUAL_PRECHECK_ENABLED = 'true';
    const det = productDetector();
    expect(det).toBeInstanceOf(YoloxNanoDetector);
  });
});

// ---------------------------------------------------------------------------
// Local inference smoke test (real model + real onnxruntime-node)
// ---------------------------------------------------------------------------

describe('local inference smoke test', () => {
  const MODEL_PATH = path.join(process.cwd(), 'models', 'yolox', 'yolox_nano.onnx');

  test(
    'runs real model on a synthetic JPEG, result is null or valid in-range box',
    async () => {
      // Skip gracefully if onnxruntime-node cannot be loaded.
      let ort: unknown;
      try {
        ort = await import('onnxruntime-node');
      } catch {
        console.warn('[smoke] onnxruntime-node not loadable — skipping');
        return;
      }
      void ort; // suppress unused warning

      // Skip gracefully if model file is absent.
      if (!fs.existsSync(MODEL_PATH)) {
        console.warn('[smoke] model file absent at', MODEL_PATH, '— skipping');
        return;
      }

      const frame = await solidJpeg(200, 150, 100);

      // Use real detector (verify=true, real session factory).
      const detector = new YoloxNanoDetector();
      const [result] = await detector.detect([frame]);

      // A solid-color image has no detectable objects; null is the expected result.
      if (result === null) {
        expect(result).toBeNull();
        return;
      }

      // If somehow something is detected, verify the box is within bounds.
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.box.x).toBeGreaterThanOrEqual(0);
      expect(result.box.y).toBeGreaterThanOrEqual(0);
      expect(result.box.w).toBeGreaterThan(0);
      expect(result.box.h).toBeGreaterThan(0);
      expect(result.box.x + result.box.w).toBeLessThanOrEqual(1 + 1e-6);
      expect(result.box.y + result.box.h).toBeLessThanOrEqual(1 + 1e-6);
    },
    60_000, // 60 s timeout for first native load + warm-up inference
  );
});

// Review finding 6: edge clipping must preserve the visible intersection.
test.each([
  [0.9, 0.9, 0.2, 0.2, 0.9, 0.9, 0.1, 0.1],
  [-0.1, -0.1, 0.3, 0.3, 0, 0, 0.2, 0.2],
  [-0.5, -0.5, 2, 2, 0, 0, 1, 1],
])('clips decoded edges for box (%s,%s,%s,%s)', async (x,y,w,h,ex,ey,ew,eh) => {
  const data = syntheticOutput(0.9, 0.9);
  const base = 530 * 85;
  data[base] = (x + w/2) * 416/8 - 10;
  data[base+1] = (y + h/2) * 416/8 - 10;
  data[base+2] = Math.log(w * 416/8);
  data[base+3] = Math.log(h * 416/8);
  const [result] = await new YoloxNanoDetector(makeSession(data), false).detect([await solidJpeg()]);
  expect(result).not.toBeNull();
  expect(result!.box.x).toBeCloseTo(ex); expect(result!.box.y).toBeCloseTo(ey);
  expect(result!.box.w).toBeCloseTo(ew); expect(result!.box.h).toBeCloseTo(eh);
  expect(result!.box.x + result!.box.w).toBeLessThanOrEqual(1);
  expect(result!.box.y + result!.box.h).toBeLessThanOrEqual(1);
});
test.each([[-0.3,0.5], [1.3,0.5], [0.5,-0.3], [0.5,1.3]])('rejects fully outside box centered at %s,%s', async (cx,cy) => {
  const data = syntheticOutput(0.9,0.9), base=530*85;
  data[base]=cx*416/8-10; data[base+1]=cy*416/8-10;
  data[base+2]=Math.log(0.1*416/8); data[base+3]=Math.log(0.1*416/8);
  expect(await new YoloxNanoDetector(makeSession(data),false).detect([await solidJpeg()])).toEqual([null]);
});
