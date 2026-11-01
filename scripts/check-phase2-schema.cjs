'use strict';

// Read-only catalog check. Only the CLI entry point connects to PostgreSQL.
const required = {
  uq_render_tasks_active_test_job: ['test_queued', 'test_claimed'],
  uq_render_tasks_active_all_job: ['queued', 'claimed', 'test_queued', 'test_claimed'],
};
async function checkPhase2Schema(db) {
  const { rows } = await db.query(`SELECT c.relname AS name, i.indisunique, i.indisvalid,
      pg_get_indexdef(i.indexrelid, 1, true) AS key,
      i.indnkeyatts, i.indnatts,
      pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'render_tasks'::regclass`);
  for (const [name, states] of Object.entries(required)) {
    const index = rows.find(row => row.name === name);
    const normalized = index?.predicate?.replace(/::text\[\]|::text/g, '').replace(/[\s()]/g, '').toLowerCase();
    const values = states.map(state => "'" + state + "'").join(',');
    if (!index || !index.indisunique || !index.indisvalid
        || index.key !== 'job_id' || Number(index.indnkeyatts) !== 1 || Number(index.indnatts) !== 1
        || !["statein" + values, "state=anyarray[" + values + "]"].includes(normalized)) {
      throw new Error(`Phase 2 prerequisite missing/invalid: ${name}; verify migrations 057 and 058`);
    }
  }
  const columns = [
    ['asset_visual_analyses', 'asset_id'], ['storyboard_versions', 'request_id'],
    ['clip_requests', 'storyboard_version_id'], ['clip_requests', 'delivered_storyboard_version_id'],
    ['uploaded_assets', 'storyboard_version_id'], ['video_generation_jobs', 'storyboard_version_id'],
  ];
  const catalog = await db.query(`SELECT c.relname AS table_name, a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND a.attnum>0 AND NOT a.attisdropped
      AND c.relname = ANY($1::text[])`, [[...new Set(columns.map(([table]) => table))]]);
  for (const [table, column] of columns) {
    if (!catalog.rows.some(r => r.table_name === table && r.column_name === column && r.data_type === 'uuid')) {
      throw new Error('Phase 2 prerequisite missing/invalid: ' + table + '.' + column + '; verify migrations 055 and 056');
    }
  }
  const fks = await db.query(`SELECT c.relname AS table_name, a.attname AS column_name,
      t.relname AS target_table, ta.attname AS target_column, f.confdeltype, f.convalidated
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class t ON t.oid=f.confrelid
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=f.conkey[1]
    JOIN pg_attribute ta ON ta.attrelid=t.oid AND ta.attnum=f.confkey[1]
    WHERE n.nspname=current_schema() AND f.contype='f'
      AND cardinality(f.conkey)=1 AND cardinality(f.confkey)=1
      AND c.relname IN ('asset_visual_analyses','storyboard_versions')`);
  for (const [table, column, target, deletion] of [
    ['asset_visual_analyses', 'asset_id', 'uploaded_assets', 'c'],
    ['storyboard_versions', 'request_id', 'clip_requests', 'a'],
  ]) {
    if (!fks.rows.some(r => r.table_name===table && r.column_name===column && r.target_table===target
        && r.target_column==='id' && r.confdeltype===deletion && r.convalidated)) {
      throw new Error('Phase 2 prerequisite missing/invalid: ' + table + ' FK; verify migrations 055 and 056');
    }
  }
}
module.exports = { checkPhase2Schema };
if (require.main === module) {
  const { Pool } = require('pg');
  const db = new Pool({
    user: process.env.PG_USER?.trim(), password: process.env.PG_PASSWORD?.trim(),
    ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000,
  });
  checkPhase2Schema(db)
    .then(() => console.log('Phase 2 schema prerequisites passed'))
    .catch(() => { console.error('Phase 2 schema preflight failed; verify migrations 055 through 058'); process.exitCode = 1; })
    .finally(() => db.end());
}
