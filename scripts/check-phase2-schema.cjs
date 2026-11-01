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
}
module.exports = { checkPhase2Schema };
if (require.main === module) {
  const { Pool } = require('pg');
  const db = new Pool({
    user: process.env.PG_USER?.trim(), password: process.env.PG_PASSWORD?.trim(),
    ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 15000,
  });
  checkPhase2Schema(db)
    .then(() => console.log('Phase 2 index prerequisites passed'))
    .catch(() => { console.error('Phase 2 schema preflight failed; verify migrations 057 and 058'); process.exitCode = 1; })
    .finally(() => db.end());
}
