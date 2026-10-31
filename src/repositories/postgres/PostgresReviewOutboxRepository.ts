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

export class PostgresReviewOutboxRepository implements IReviewOutboxRepository {
  constructor(private db = pool) {}

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
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
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
      `UPDATE review_outbox SET state='sending', attempts=attempts+1
        WHERE id = (
          SELECT id FROM review_outbox
           WHERE state IN ('queued','failed') AND next_attempt_at <= NOW()
           ORDER BY next_attempt_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING *`
    );
    return rows[0] ? rowToEvent(rows[0]) : null;
  }

  async markSent(id: string): Promise<void> {
    await this.db.query(
      `UPDATE review_outbox SET state='sent', sent_at=NOW() WHERE id=$1`,
      [id]
    );
  }

  async markFailed(id: string, error: string, statusCode?: number, nextAttemptAt?: Date): Promise<void> {
    await this.db.query(
      `UPDATE review_outbox SET
         state='failed', last_error=$2, last_status_code=$3,
         next_attempt_at=COALESCE($4, NOW() + interval '5 minutes'),
         updated_at=NOW()
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
