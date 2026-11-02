import { readFileSync } from 'fs';

// 060 is proposed only (Tho applies migrations). It must stay additive,
// transactional and rerunnable, and must not touch any other table.
const sql = readFileSync('src/db/migrations/060_line_conversation_event_is_test.sql', 'utf8');
const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

test('060 adds is_test to both LINE tables idempotently inside one transaction', () => {
  expect(body.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
  expect(body).toContain('ALTER TABLE line_conversation_states ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE');
  expect(body).toContain('ALTER TABLE line_webhook_events      ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE');
  expect(body.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
});

test('060 is additive: no drops, deletes, truncates or type changes; backfill only sets TRUE', () => {
  expect(body).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  expect(body).not.toMatch(/ALTER\s+COLUMN/i);
  const updates = body.match(/UPDATE\s+\w+/gi) ?? [];
  expect(updates.map(u => u.split(/\s+/)[1])).toEqual(['line_conversation_states', 'line_webhook_events']);
  expect(body.match(/SET is_test = TRUE/g)).toHaveLength(2);
  expect(body.match(/la\.is_test = TRUE/g)).toHaveLength(2);
});
