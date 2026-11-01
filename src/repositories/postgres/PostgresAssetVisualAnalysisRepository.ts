import { pool } from '@/lib/db';
import type { IAssetVisualAnalysisRepository } from '../interfaces/IAssetVisualAnalysisRepository';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';
export class PostgresAssetVisualAnalysisRepository implements IAssetVisualAnalysisRepository {
  constructor(private db = pool) {}
  async enqueue(id: string, version: string) { await this.db.query(`INSERT INTO asset_visual_analyses(asset_id,analysis_version) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, version]); }
  async claim(version: string): Promise<string | null> {
    const { rows } = await this.db.query(`UPDATE asset_visual_analyses SET state='claimed',claimed_at=NOW() WHERE (asset_id,analysis_version)=(SELECT asset_id,analysis_version FROM asset_visual_analyses WHERE state='queued' AND analysis_version=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING asset_id`, [version]);
    return rows[0]?.asset_id ?? null;
  }
  async get(id: string, version: string): Promise<AssetVisualAnalysis | null> { const { rows } = await this.db.query(`SELECT result FROM asset_visual_analyses WHERE asset_id=$1 AND analysis_version=$2 AND state='done'`, [id, version]); return rows[0]?.result ?? null; }
  async pending(id: string, version: string): Promise<boolean> {
    const { rows } = await this.db.query(`SELECT state FROM asset_visual_analyses WHERE asset_id=$1 AND analysis_version=$2`, [id, version]);
    return ['queued','claimed'].includes(rows[0]?.state);
  }
  async expireClaims(version: string, timeoutSeconds: number): Promise<string[]> {
    const { rows } = await this.db.query(`UPDATE asset_visual_analyses SET state='failed' WHERE analysis_version=$1 AND state='claimed' AND claimed_at < NOW()-($2 * INTERVAL '1 second') RETURNING asset_id`, [version,timeoutSeconds]);
    return rows.map(r => r.asset_id as string);
  }
  async save(value: AssetVisualAnalysis) { await this.db.query(`UPDATE asset_visual_analyses SET result=$3::jsonb,state='done' WHERE asset_id=$1 AND analysis_version=$2 AND state='claimed'`, [value.assetId, value.version, JSON.stringify(value)]); }
  async fail(id: string, version: string) { await this.db.query(`UPDATE asset_visual_analyses SET state='failed' WHERE asset_id=$1 AND analysis_version=$2`, [id, version]); }
}
