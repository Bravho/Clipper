import { IReviewOutboxRepository, OutboxEvent } from '@/repositories/interfaces/IReviewOutboxRepository';
import { pool } from '@/lib/db';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value as string) as T; } catch { return fallback; }
}

function rowToEvent(row: Record<string, unknown>): OutboxEvent {
  return {
    id: String(row.id),
    eventId: row.event_id as string,
    eventType: row.event_type as string,
    channel: row.channel as string,
    reviewItemId: (row.review_item_id as string) ?? null,
    dedupeKey: (row.dedupe_key as string) ?? null,
    payload: parseJson(row.payload, {}),
    state: row.state as OutboxEvent['state'],
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: new Date(row.next_attempt_at as string),
    lastError: (row.last_error as string) ?? null,
    lastStatusCode: row.last_status_code != null ? Number(row.last_status_code) : null,
    sentAt: row.sent_at ? new Date(row.sent_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

/** An escalation outbox row aliased `x` joined to its review item `i`. */
const ESCALATION_ROW_SQL = `(x.event_type='handoff.escalate' OR (x.event_type='review.created' AND i.type_key IN ('customer_reply','complaint','out_of_package')))`;

export class PostgresReviewOutboxRepository implements IReviewOutboxRepository {
  constructor(private db = pool, private notificationBudget?: (shopUserId: string) => Promise<boolean>) {}

  async reserveHandoffNotification(shopUserId: string): Promise<boolean> {
    if (!this.notificationBudget) throw new Error('handoff_notification_budget_not_configured');
    return this.notificationBudget(shopUserId);
  }

  async findByDedupeKey(key: string): Promise<OutboxEvent | null> {
    const { rows } = await this.db.query("SELECT * FROM review_outbox WHERE channel='grokbot_app' AND dedupe_key=$1", [key]);
    return rows[0] ? rowToEvent(rows[0]) : null;
  }
  async listRecentReplies(accountId?: string, since?: Date): Promise<OutboxEvent[]> {
    const { rows } = await this.db.query(`SELECT o.*, COALESCE(ri.shop_user_id::text, la.user_id::text) AS owner_shop_id
      FROM review_outbox o LEFT JOIN review_items ri ON ri.id=o.review_item_id
      LEFT JOIN line_accounts la ON la.id::text=o.payload->>'lineAccountId'
      WHERE o.channel='grokbot_app' AND o.event_type='line.reply'
      AND ($2::timestamptz IS NULL OR o.created_at > $2)
      AND ($1::text IS NULL OR o.payload->>'lineAccountId'=$1)
      ORDER BY o.created_at DESC`, [accountId ?? null, since ?? null]);
    return rows.map(row => ({ ...rowToEvent(row), payload: { ...parseJson<Record<string, unknown>>(row.payload, {}),
      ...(row.owner_shop_id ? { shopUserId: row.owner_shop_id } : {}) } }));
  }
  async reserveEscalationSlot(eventRowId: string, shopUserId: string, since: Date, limit: number): Promise<boolean> {
    // Lock and check must be separate statements: under READ COMMITTED each
    // statement takes a fresh snapshot, so the UPDATE below sees every
    // reservation committed by a worker that held the lock before us. (A
    // single statement would read a snapshot taken before the lock was granted.)
    const run = async (db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('line.escalation.cap'), hashtext($1::text))", [shopUserId]);
      const { rows } = await db.query(`UPDATE review_outbox o SET sent_at = NOW()
        WHERE o.id = $1 AND o.state = 'sending'
          AND (SELECT count(*) FROM review_outbox x JOIN review_items i ON i.id = x.review_item_id
                WHERE i.shop_user_id::text = $2 AND x.id <> o.id
                  AND x.state IN ('sent','sending') AND x.sent_at > $3
                  AND ${ESCALATION_ROW_SQL}) < $4
        RETURNING o.id`, [eventRowId, shopUserId, since.toISOString(), limit]);
      return rows.length > 0;
    };
    type Q = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
    const db = this.db as unknown as { connect?: () => Promise<Q & { release: () => void }>; release?: unknown };
    if (typeof db.release === 'function' || typeof db.connect !== 'function') {
      // Already a checked-out client (caller owns the transaction).
      return run(this.db as never);
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const ok = await run(client as never);
      await client.query('COMMIT');
      return ok;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  async countEscalations(shopUserId: string, since: Date): Promise<number> {
    const { rows } = await this.db.query(`SELECT count(*) AS count FROM review_outbox o JOIN review_items i ON i.id=o.review_item_id WHERE i.shop_user_id::text=$1 AND o.state='sent' AND o.sent_at>$2 AND ${ESCALATION_ROW_SQL.replace(/\bx\./g, 'o.')}`, [shopUserId, since]);
    return Number(rows[0].count);
  }
  async enqueue(input: {
    eventType: string;
    channel?: string;
    reviewItemId?: string;
    dedupeKey?: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: Date;
  }): Promise<OutboxEvent> {
    const { rows } = await this.db.query(
      `INSERT INTO review_outbox
         (event_type, channel, review_item_id, dedupe_key, payload, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (channel,dedupe_key) WHERE dedupe_key IS NOT NULL
       DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING *`,
      [
        input.eventType,
        input.channel ?? 'grokbot_app',
        input.reviewItemId ?? null,
        input.dedupeKey ?? null,
        JSON.stringify(input.payload),
        (input.nextAttemptAt ?? new Date()).toISOString(),
      ]
    );
    return rowToEvent(rows[0]);
  }

  async claimNext(): Promise<OutboxEvent | null> {
    const { rows } = await this.db.query(
      `UPDATE review_outbox SET state='sending', attempts=attempts+1, next_attempt_at=NOW() + interval '2 minutes'
        WHERE id = (
          SELECT id FROM review_outbox
           WHERE state IN ('queued','failed','sending') AND next_attempt_at <= NOW()
             AND (SELECT CASE WHEN review_outbox.event_type='line.reply' THEN
                 (SELECT is_test FROM line_accounts WHERE id::text=review_outbox.payload->>'lineAccountId')
                 ELSE COALESCE(cr.is_test, po.is_test,
                 (SELECT bool_or(la.is_test) FROM line_accounts la
                  WHERE la.user_id::text=COALESCE(ri.shop_user_id::text, review_outbox.payload->>'user_id'))) END
               FROM (SELECT 1) owner_anchor
               LEFT JOIN review_items ri ON ri.id=review_outbox.review_item_id
               LEFT JOIN storyboard_versions sv ON sv.id::text=review_outbox.payload->>'version_id'
               LEFT JOIN video_generation_jobs vj ON vj.id::text=review_outbox.payload->>'job_id'
               LEFT JOIN clip_requests cr ON cr.id::text=COALESCE(ri.request_id::text,
                 sv.request_id::text, vj.request_id::text, review_outbox.payload->>'request_id')
               LEFT JOIN package_orders po ON po.id::text=COALESCE(ri.package_order_id::text,
                 review_outbox.payload->>'package_order_id', review_outbox.payload->>'order_id')) = $1::boolean
           ORDER BY next_attempt_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING *`, [process.env.LINE_TEST_MODE === 'true']
    );
    return rows[0] ? rowToEvent(rows[0]) : null;
  }

  async markSent(id: string): Promise<void> {
    await this.db.query(
      `UPDATE review_outbox SET state='sent', sent_at=NOW() WHERE id=$1`,
      [id]
    );
  }

  async defer(id: string, nextAttemptAt: Date): Promise<void> {
    await this.db.query("UPDATE review_outbox SET state='queued', attempts=GREATEST(attempts-1,0), next_attempt_at=$2 WHERE id=$1", [id, nextAttemptAt.toISOString()]);
  }

  async markFailed(id: string, error: string, statusCode?: number, nextAttemptAt?: Date): Promise<void> {
    await this.db.query(
      `UPDATE review_outbox SET
         state='failed', last_error=$2, last_status_code=$3,
         next_attempt_at=COALESCE($4, NOW() + interval '5 minutes')
       WHERE id=$1`,
      [id, error, statusCode ?? null, nextAttemptAt?.toISOString() ?? null]
    );
  }

  async markDead(id: string): Promise<void> {
    await this.db.query(
      `UPDATE review_outbox SET state='dead' WHERE id=$1`,
      [id]
    );
  }
}
