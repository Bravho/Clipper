import { readFileSync } from 'fs';

test.each([
 ['055_asset_visual_analyses.sql', 'asset_visual_analyses', 'asset_id', 'uploaded_assets'],
 ['056_storyboard_versions.sql', 'storyboard_versions', 'request_id', 'clip_requests'],
])('production UUID migration %s is transactional and rerunnable', (file, table, column, target) => {
 const sql = readFileSync('src/db/migrations/' + file, 'utf8');
 expect(sql.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
 expect(sql).toContain('CREATE TABLE IF NOT EXISTS ' + table);
 expect(sql).toContain(column + ' UUID NOT NULL REFERENCES ' + target + '(id)');
 expect(sql).not.toMatch(/TEXT\s+(?:NOT NULL\s+)?REFERENCES\s+(?:uploaded_assets|clip_requests)/i);
 expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
 expect(sql).toContain('DO $$');
 expect(sql).toContain('END $$;');
 expect(sql).toContain('IF NOT EXISTS (SELECT 1 FROM pg_constraint');
 expect(sql).toContain("conrelid = '" + table + "'::regclass");
 expect(sql).toContain('LOCK TABLE ' + table + ' IN ACCESS EXCLUSIVE MODE');
 expect(sql).toContain('IF EXISTS (SELECT 1 FROM ' + table + ')');
 expect(sql).toContain('RAISE EXCEPTION');
 expect(sql).toContain('TYPE UUID USING ' + column + '::uuid');
 expect(sql).not.toMatch(/DROP\s/i);
 if (column === 'asset_id') expect(sql).toContain('ON DELETE CASCADE');
 if (column === 'request_id') expect(sql.match(/ADD COLUMN IF NOT EXISTS \w+ UUID REFERENCES storyboard_versions\(id\)/g)).toHaveLength(4);
});
