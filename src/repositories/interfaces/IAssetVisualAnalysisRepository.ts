import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
export interface IAssetVisualAnalysisRepository {
  enqueue(assetId: string, version: string): Promise<void>;
  claim(version: string): Promise<string | null>;
  pending(assetId: string, version: string): Promise<boolean>;
  expireClaims(version: string, timeoutSeconds: number): Promise<string[]>;
  get(assetId: string, version: string): Promise<AssetVisualAnalysis | null>;
  save(value: AssetVisualAnalysis): Promise<void>;
  fail(assetId: string, version: string): Promise<void>;
}
