import { readFileSync } from 'fs';
import { join } from 'path';

test('053–056 foreign keys match the earlier TEXT request/asset IDs and UUID version IDs', () => {
 const read = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');
 const earlier = read('migrations/002_phase2b_pipeline_tables.sql');
 for (const table of ['clip_requests', 'uploaded_assets']) {
  expect(earlier).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(\\s*id\\s+TEXT\\s+PRIMARY KEY`));
 }
 // Enumerate exact names from the directory without reading configuration files.
 const { readdirSync } = require('fs') as typeof import('fs');
 const migrations = readdirSync(join(process.cwd(), 'src/db/migrations')).filter(n => /^05[3-6]_/.test(n));
 expect(migrations).toHaveLength(4);
 const sql = migrations.map(n => read('src/db/migrations/' + n)).join('\n');
 const targets: Record<string, string> = { uploaded_assets: 'TEXT', clip_requests: 'TEXT', storyboard_versions: 'UUID' };
 const fks = [...sql.matchAll(/(\w+)\s+(TEXT|UUID)(?:\s+NOT NULL)?\s+REFERENCES\s+(\w+)\(id\)/g)];
 expect(fks).toHaveLength(7);
 for (const fk of fks) expect(fk[2]).toBe(targets[fk[3]]);
 expect(sql).toMatch(/id UUID PRIMARY KEY/);
 expect(sql).toContain('dispatched_at TIMESTAMPTZ');
});
