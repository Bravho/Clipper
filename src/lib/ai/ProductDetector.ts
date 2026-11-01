import type { ProductDetection } from '@/domain/models/AssetVisualAnalysis';
import { visualEnabled } from '@/config/storyboardVisual';

export interface ProductDetector {
  /** One normalized, source-frame box (or null) per JPEG. No remote inference. */
  detect(frames: Buffer[]): Promise<(ProductDetection | null)[]>;
}
export class NoopProductDetector implements ProductDetector {
  async detect(frames: Buffer[]) { return frames.map(() => null); }
}
export class MockProductDetector implements ProductDetector {
  constructor(private results: (ProductDetection | null)[] = []) {}
  async detect(frames: Buffer[]) { return frames.map((_, i) => this.results[i] ?? null); }
}

// Singleton cached for the worker process lifetime.
let _yoloxInstance: ProductDetector | null = null;

export function productDetector(): ProductDetector {
  const mode = process.env.STORYBOARD_PRODUCT_DETECTOR;
  // Mock selection never invents evidence; tests inject explicit detections.
  if (mode === 'mock') return new MockProductDetector();
  if (mode === 'yolox' && visualEnabled()) {
    if (!_yoloxInstance) {
      // Dynamic require defers native-module load until first use.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { YoloxNanoDetector } = require('./YoloxNanoDetector');
      _yoloxInstance = new YoloxNanoDetector() as ProductDetector;
    }
    return _yoloxInstance!;
  }
  return new NoopProductDetector();
}
