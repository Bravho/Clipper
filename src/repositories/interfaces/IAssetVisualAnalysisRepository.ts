import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
export interface IAssetVisualAnalysisRepository {
  enqueue(assetId: string, version: string): Promise<void>;
  claim(version: string): Promise<string | null>;
  pending(assetId: string, version: string): Promise<boolean>;
  expireClaims(version: string, timeoutSeconds: number): Promise<string[]>;
  get(assetId: string, version: string): Promise<AssetVisualAnalysis | null>;
  save(value: AssetVisualAnalysis): Promise<void>;
  fail(assetId: string, version: string): Promise<void>;
  /** Strip base64 frame image data from done rows older than cutoffDate. Detection/metrics are preserved.
   *  Dry-run (execute=false) returns the count of rows that would be modified without changing anything. */
  purgeOldFrameData(cutoffDate: Date, execute: boolean): Promise<{ count: number }>;
}
