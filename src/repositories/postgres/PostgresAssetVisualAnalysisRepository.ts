import { pool } from '@/lib/db';
import { isLineTestMode } from '@/config/reviewSystem';
import type { IAssetVisualAnalysisRepository } from '../interfaces/IAssetVisualAnalysisRepository';
import type { AssetVisualAnalysis } from '@/domain/models/AssetVisualAnalysis';

export class PostgresAssetVisualAnalysisRepository implements IAssetVisualAnalysisRepository {
  constructor(private db = pool) {}

  async enqueue(id: string, version: string) {
    await this.db.query(
      `INSERT INTO asset_visual_analyses(asset_id,analysis_version) VALUES($1::uuid,$2) ON CONFLICT DO NOTHING`,
      [id, version]
    );
  }

  async claim(version: string): Promise<string | null> {
    // is_test guard: join uploaded_assets → clip_requests to filter by is_test.
    // A non-test worker skips assets whose clip_request is a test record;
    // the test worker claims only test-request assets.
    // Requires migration 054 (clip_requests.is_test) to be applied.
    // Uses LEFT JOINs so assets with no associated request (uploaded outside
    // the LINE flow) are treated as non-test and claimed by the production worker.
    const testMode = isLineTestMode();
    const { rows } = await this.db.query(
      `UPDATE asset_visual_analyses
          SET state='claimed', claimed_at=NOW()
        WHERE (asset_id, analysis_version) = (
          SELECT ava.asset_id, ava.analysis_version
            FROM asset_visual_analyses ava
            LEFT JOIN uploaded_assets ua ON ua.id = ava.asset_id
            LEFT JOIN clip_requests cr ON cr.id = ua.request_id
           WHERE ava.state = 'queued' AND ava.analysis_version = $1
             AND ($2::boolean = FALSE OR COALESCE(cr.is_test, FALSE) = TRUE)
             AND ($2::boolean = TRUE  OR COALESCE(cr.is_test, FALSE) = FALSE)
           ORDER BY ava.created_at
           FOR UPDATE OF ava SKIP LOCKED
           LIMIT 1
        )
        RETURNING asset_id`,
      [version, testMode]
    );
    return rows[0]?.asset_id ?? null;
  }

  async get(id: string, version: string): Promise<AssetVisualAnalysis | null> {
    const { rows } = await this.db.query(
      `SELECT result FROM asset_visual_analyses WHERE asset_id=$1::uuid AND analysis_version=$2 AND state='done'`,
      [id, version]
    );
    return rows[0]?.result ?? null;
  }

  async pending(id: string, version: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT state FROM asset_visual_analyses WHERE asset_id=$1::uuid AND analysis_version=$2`,
      [id, version]
    );
    return ['queued', 'claimed'].includes(rows[0]?.state);
  }

  async expireClaims(version: string, timeoutSeconds: number): Promise<string[]> {
    const { rows } = await this.db.query(
      `UPDATE asset_visual_analyses ava SET state='failed'
        WHERE analysis_version=$1 AND state='claimed'
          AND claimed_at < NOW()-($2 * INTERVAL '1 second')
          AND COALESCE((SELECT cr.is_test FROM uploaded_assets ua
            LEFT JOIN clip_requests cr ON cr.id = ua.request_id
            WHERE ua.id = ava.asset_id), FALSE) = $3::boolean
        RETURNING ava.asset_id`,
      [version, timeoutSeconds, isLineTestMode()]
    );
    return rows.map(r => r.asset_id as string);
  }

  async save(value: AssetVisualAnalysis) {
    await this.db.query(
      `UPDATE asset_visual_analyses SET result=$3::jsonb,state='done' WHERE asset_id=$1::uuid AND analysis_version=$2 AND state='claimed'`,
      [value.assetId, value.version, JSON.stringify(value)]
    );
  }

  async fail(id: string, version: string) {
    await this.db.query(
      `UPDATE asset_visual_analyses SET state='failed' WHERE asset_id=$1::uuid AND analysis_version=$2`,
      [id, version]
    );
  }

  async purgeOldFrameData(cutoffDate: Date, execute: boolean): Promise<{ count: number }> {
    // Only touches asset_visual_analyses rows (state='done', older than cutoff) that still have frame data.
    // Detection and metrics inside each frame are preserved; only the base64 'data' key is stripped.
    const hasData = `EXISTS (SELECT 1 FROM jsonb_array_elements(result->'frames') f WHERE f->>'data' IS NOT NULL)`;
    const where = `state = 'done' AND created_at < $1 AND result IS NOT NULL AND ${hasData}`;
    if (!execute) {
      const { rows } = await this.db.query(
        `SELECT COUNT(*)::int AS count FROM asset_visual_analyses WHERE ${where}`,
        [cutoffDate]
      );
      return { count: rows[0]?.count ?? 0 };
    }
    const { rowCount } = await this.db.query(
      `UPDATE asset_visual_analyses
          SET result = jsonb_set(result, '{frames}',
            (SELECT jsonb_agg(jsonb_set(f, '{data}', 'null'::jsonb)) FROM jsonb_array_elements(result->'frames') AS f))
        WHERE ${where}`,
      [cutoffDate]
    );
    return { count: rowCount ?? 0 };
  }
}
