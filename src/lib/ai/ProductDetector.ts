import type { ProductDetection } from '@/domain/models/AssetVisualAnalysis';
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
export function productDetector(): ProductDetector {
  // Mock selection never invents evidence; tests inject explicit detections.
  return process.env.STORYBOARD_PRODUCT_DETECTOR === 'mock' ? new MockProductDetector() : new NoopProductDetector();
}
