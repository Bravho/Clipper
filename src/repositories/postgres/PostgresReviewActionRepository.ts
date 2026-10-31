import { IReviewActionRepository } from '@/repositories/interfaces/IReviewActionRepository';
import { ReviewAction, CreateReviewActionInput } from '@/domain/models/ReviewAction';
import { pool } from '@/lib/db';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value as string) as T; } catch { return fallback; }
}

function rowToAction(row: Record<string, unknown>): ReviewAction {
  return {
    id: String(row.id),
    reviewItemId: row.review_item_id as string,
    itemVersion: Number(row.item_version),
    action: row.action as ReviewAction['action'],
    actorUserId: (row.actor_user_id as string) ?? null,
    actorVia: row.actor_via as ReviewAction['actorVia'],
    fromStatus: (row.from_status as string) ?? null,
    toStatus: (row.to_status as string) ?? null,
    reasonCode: (row.reason_code as ReviewAction['reasonCode']) ?? null,
    reasonText: (row.reason_text as string) ?? null,
    diff: parseJson(row.diff, null),
    detail: parseJson(row.detail, {}),
    clientElapsedMs: row.client_elapsed_ms != null ? Number(row.client_elapsed_ms) : null,
    createdAt: new Date(row.created_at as string),
  };
}

export class PostgresReviewActionRepository implements IReviewActionRepository {
  constructor(private db = pool) {}

  async create(input: CreateReviewActionInput): Promise<ReviewAction> {
    const { rows } = await this.db.query(
      `INSERT INTO review_actions (
         review_item_id, item_version, action, actor_user_id, actor_via,
         from_status, to_status, reason_code, reason_text, diff,
         detail, client_elapsed_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        input.reviewItemId,
        input.itemVersion,
        input.action,
        input.actorUserId ?? null,
        input.actorVia,
        input.fromStatus ?? null,
        input.toStatus ?? null,
        input.reasonCode ?? null,
        input.reasonText ?? null,
        input.diff ? JSON.stringify(input.diff) : null,
        JSON.stringify(input.detail ?? {}),
        input.clientElapsedMs ?? null,
      ]
    );
    return rowToAction(rows[0]);
  }

  async listByItem(reviewItemId: string): Promise<ReviewAction[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM review_actions WHERE review_item_id = $1 ORDER BY id ASC',
      [reviewItemId]
    );
    return rows.map(rowToAction);
  }
}
