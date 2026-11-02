/**
 * Test isolation for Channel Management (social publishing).
 *
 * management_jobs / management_publications have no is_test column, and the
 * Phase 2 LINE test runs against the LIVE database. Two rules keep test work
 * away from real shops and real social accounts:
 *
 *  1. A process started with LINE_TEST_MODE=true never publishes, edits or
 *     cancels a post and never enqueues or claims a management job. The test
 *     server serves the whole app, so this also stops it touching real shops.
 *  2. In any process, work owned by a test subject is refused: a user who has
 *     an is_test LINE account, or content made from an is_test clip request.
 *     Jobs are resolved to their owner through payload.userId / publicationId /
 *     managementContentId, so the provider-webhook path is covered too.
 *
 * Residual risk (no code can fix it): an already-deployed production
 * management worker runs the OLD claim query and would still claim a test-owned
 * job that was queued before this guard existed. See the report for the
 * read-only check.
 */

import { pool } from '@/lib/db';

type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export class ManagementTestIsolationError extends Error {
  readonly code = 'test_isolation' as const;
  constructor(message = 'Management work is disabled for test data.') {
    super(message);
    this.name = 'ManagementTestIsolationError';
  }
}

export function managementTestModeProcess(): boolean {
  return process.env.LINE_TEST_MODE === 'true';
}

/**
 * SQL predicate: TRUE when the user / clip request named by the two text
 * expressions belongs to test data. Either expression may evaluate to NULL.
 */
export function testOwnerPredicateSql(userTextExpr: string, requestTextExpr: string): string {
  return `(EXISTS (SELECT 1 FROM line_accounts la_t WHERE la_t.user_id::text = ${userTextExpr} AND la_t.is_test = TRUE)
    OR EXISTS (SELECT 1 FROM clip_requests cr_t WHERE cr_t.id::text = ${requestTextExpr} AND cr_t.is_test = TRUE))`;
}

/**
 * SQL predicate over a management_jobs row aliased `alias`: TRUE when the job's
 * owner (payload.userId, the publication's user, or the content's user/source
 * request) is test data.
 */
export function managementJobTestOwnerSql(alias: string): string {
  return `EXISTS (
    SELECT 1 FROM (SELECT 1) anchor_t
      LEFT JOIN management_publications mp_t ON mp_t.id::text = ${alias}.payload->>'publicationId'
      LEFT JOIN management_content_items mci_t ON mci_t.id::text =
        COALESCE(${alias}.payload->>'managementContentId', mp_t.management_content_id::text)
     WHERE ${testOwnerPredicateSql(
       `COALESCE(${alias}.payload->>'userId', mp_t.user_id::text, mci_t.user_id::text)`,
       `mci_t.source_generation_id::text`)}
  )`;
}

/** Same owner resolution as managementJobTestOwnerSql, for a payload before insert. */
export async function isTestOwnedJobPayload(payload: Record<string, unknown>, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT ${managementJobTestOwnerSql('j')} AS is_test FROM (SELECT $1::jsonb AS payload) j`,
    [JSON.stringify(payload ?? {})]);
  return rows[0]?.is_test === true;
}

export interface ManagementTestScope {
  /** True when this user / source request is test data. */
  isTestOwned(userId: string, sourceGenerationId: string | null): Promise<boolean>;
}

export const managementTestScope: ManagementTestScope = {
  async isTestOwned(userId, sourceGenerationId) {
    const { rows } = await pool.query(
      `SELECT ${testOwnerPredicateSql('$1::text', '$2::text')} AS is_test`, [userId, sourceGenerationId]);
    return rows[0]?.is_test === true;
  },
};
