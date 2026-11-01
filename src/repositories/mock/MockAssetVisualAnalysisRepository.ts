import type { IAssetVisualAnalysisRepository } from '../interfaces/IAssetVisualAnalysisRepository';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
type Entry = { state: string; value?: AssetVisualAnalysis; assetId: string; version: string; claimedAt?: number };
export class MockAssetVisualAnalysisRepository implements IAssetVisualAnalysisRepository {
  constructor(private entries = new Map<string, Entry>()) {}
  async enqueue(assetId: string, version: string) { const key = assetId + ':' + version; if (!this.entries.has(key)) this.entries.set(key, { state: 'queued', assetId, version }); }
  async claim(version: string) { const entry = [...this.entries.values()].find(e => e.version === version && e.state === 'queued'); if (!entry) return null; entry.state = 'claimed'; entry.claimedAt = Date.now(); return entry.assetId; }
  async get(id: string, version: string) { return this.entries.get(id + ':' + version)?.value ?? null; }
  async pending(id: string, version: string) { return ['queued','claimed'].includes(this.entries.get(id + ':' + version)?.state ?? ''); }
  async expireClaims(version: string, timeoutSeconds: number) { const expired = [...this.entries.values()].filter(e => e.version === version && e.state === 'claimed' && e.claimedAt! < Date.now()-timeoutSeconds*1000); expired.forEach(e => { e.state = 'failed'; }); return expired.map(e => e.assetId); }
  async save(value: AssetVisualAnalysis) { if (this.entries.get(value.assetId + ':' + value.version)?.state === 'claimed') this.entries.set(value.assetId + ':' + value.version, { state: 'done', assetId: value.assetId, version: value.version, value }); }
  async fail(id: string, version: string) { const entry = this.entries.get(id + ':' + version); if (entry) entry.state = 'failed'; }
}
