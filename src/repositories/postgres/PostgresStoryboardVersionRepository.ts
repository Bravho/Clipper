import { pool } from '@/lib/db';
import type { StoryboardVersion, NewStoryboardVersion } from '@/domain/models/StoryboardVersion';
import type { IStoryboardVersionRepository } from '../interfaces/IStoryboardVersionRepository';
function map(r: Record<string, unknown>): StoryboardVersion {
 return { id: String(r.id), requestId: String(r.request_id), parentVersionId: r.parent_version_id as string | null,
 scenes: r.scenes as StoryboardVersion['scenes'], createdBy: r.created_by as StoryboardVersion['createdBy'], reason: String(r.reason), isTest: Boolean(r.is_test), createdAt: new Date(r.created_at as string).toISOString() };
}
export class PostgresStoryboardVersionRepository implements IStoryboardVersionRepository {
 constructor(private db = pool) {}
 async get(id: string) { const { rows } = await this.db.query('SELECT * FROM storyboard_versions WHERE id=$1', [id]); return rows[0] ? map(rows[0]) : null; }
 async latest(requestId: string) { const { rows } = await this.db.query('SELECT v.* FROM storyboard_versions v JOIN clip_requests c ON c.storyboard_version_id=v.id WHERE c.id=$1', [requestId]); return rows[0] ? map(rows[0]) : null; }
 async append(input: NewStoryboardVersion, consumeRevision = false) {
  const c = await this.db.connect();
  try {
   await c.query('BEGIN');
   const { rows } = await c.query("SELECT storyboard_version_id, revision_count, is_test FROM clip_requests WHERE id=$1 AND intake_channel='line' FOR UPDATE", [input.requestId]);
   if (!rows[0] || (rows[0].storyboard_version_id ?? null) !== input.parentVersionId || Boolean(rows[0].is_test) !== input.isTest) throw new Error('version_conflict');
   if (consumeRevision && Number(rows[0].revision_count) >= 2) throw new Error('max_revisions_exceeded');
   const result = await c.query('INSERT INTO storyboard_versions (request_id,parent_version_id,scenes,created_by,reason,is_test) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [input.requestId,input.parentVersionId,JSON.stringify(input.scenes),input.createdBy,input.reason,input.isTest]);
   await c.query('UPDATE clip_requests SET storyboard_version_id=$2,revision_count=revision_count+$3 WHERE id=$1', [input.requestId,result.rows[0].id,consumeRevision ? 1 : 0]);
   if (consumeRevision || input.reason.startsWith('restore:')) {
    await c.query("INSERT INTO review_outbox (event_type,channel,dedupe_key,payload) VALUES ('storyboard.render','line_notify',$1,$2) ON CONFLICT DO NOTHING", ['storyboard:' + result.rows[0].id, JSON.stringify({ version_id: result.rows[0].id, is_test: input.isTest })]);
   }
   await c.query('COMMIT'); return map(result.rows[0]);
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
 }
 async linkDelivery(requestId: string, versionId: string, assetIds: string[]) {
  await this.db.query('UPDATE clip_requests SET delivered_storyboard_version_id=$2 WHERE id=$1 AND storyboard_version_id=$2', [requestId,versionId]);
  await this.db.query('UPDATE uploaded_assets SET storyboard_version_id=$2 WHERE request_id=$1 AND id=ANY($3::text[]) AND storyboard_version_id IS NULL', [requestId,versionId,assetIds]);
 }
}
