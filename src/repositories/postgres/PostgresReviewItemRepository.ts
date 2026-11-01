import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import {
  ReviewItem,
  ReviewItemStatus,
  CreateReviewItemInput,
} from '@/domain/models/ReviewItem';
import { pool } from '@/lib/db';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toDate(value: unknown): Date | null {
  return value ? new Date(value as string) : null;
}

function rowToReviewItem(row: Record<string, unknown>): ReviewItem {
  return {
    id: row.id as string,
    shortCode: row.short_code as string,
    typeKey: row.type_key as string,
    status: row.status as ReviewItemStatus,
    resolution: (row.resolution as ReviewItem['resolution']) ?? null,
    renderState: (row.render_state as ReviewItem['renderState']) ?? 'none',
    version: Number(row.version ?? 1),
    supersedesId: (row.supersedes_id as string) ?? null,
    shopUserId: row.shop_user_id as string,
    requestId: (row.request_id as string) ?? null,
    jobId: (row.job_id as string) ?? null,
    gateStep: (row.gate_step as string) ?? null,
    packageOrderId: (row.package_order_id as string) ?? null,
    externalRef: (row.external_ref as string) ?? null,
    title: row.title as string,
    payload: parseJson(row.payload, {}),
    originalPayload: parseJson(row.original_payload, null),
    assetRefs: parseJson(row.asset_refs, []),
    decisionMode: row.decision_mode as ReviewItem['decisionMode'],
    matchedRules: parseJson(row.matched_rules, []),
    ruleSnapshot: parseJson(row.rule_snapshot, null),
    signals: parseJson(row.signals, {}),
    confidence: row.confidence != null ? Number(row.confidence) : null,
    producer: parseJson(row.producer, {}),
    priority: Number(row.priority ?? 100),
    decidedBy: (row.decided_by as string) ?? null,
    decidedVia: (row.decided_via as ReviewItem['decidedVia']) ?? null,
    decisionNote: (row.decision_note as string) ?? null,
    finalPayload: parseJson(row.final_payload, null),
    customerNoticedAt: toDate(row.customer_noticed_at),
    nextReminderAt: toDate(row.next_reminder_at),
    reminderSentAt: toDate(row.reminder_sent_at),
    reminderCount: Number(row.reminder_count ?? 0),
    dueAt: new Date(row.due_at as string),
    expiresAt: new Date(row.expires_at as string),
    etaToldShop: toDate(row.eta_told_shop),
    notifiedAt: toDate(row.notified_at),
    firstOpenedAt: toDate(row.first_opened_at),
    decidedAt: toDate(row.decided_at),
    idempotencyKey: (row.idempotency_key as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresReviewItemRepository implements IReviewItemRepository {
  constructor(private db = pool) {}

  async create(input: CreateReviewItemInput): Promise<ReviewItem> {
    const { rows } = await this.db.query(
      `INSERT INTO review_items (
         short_code, type_key, shop_user_id, request_id, job_id, gate_step,
         package_order_id, external_ref, title, payload, original_payload,
         asset_refs, decision_mode, matched_rules, rule_snapshot, signals,
         confidence, producer, priority, due_at, expires_at, idempotency_key
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       ) RETURNING *`,
      [
        input.idempotencyKey
          ? input.idempotencyKey.slice(0, 8).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase()
          : _generateShortCode(),
        input.typeKey,
        input.shopUserId,
        input.requestId ?? null,
        input.jobId ?? null,
        input.gateStep ?? null,
        input.packageOrderId ?? null,
        input.externalRef ?? null,
        input.title,
        JSON.stringify(input.payload),
        null,
        JSON.stringify(input.assetRefs ?? []),
        input.decisionMode,
        JSON.stringify(input.matchedRules),
        input.ruleSnapshot ? JSON.stringify(input.ruleSnapshot) : null,
        JSON.stringify(input.signals),
        input.confidence ?? null,
        JSON.stringify(input.producer ?? {}),
        input.priority ?? 100,
        input.dueAt.toISOString(),
        input.expiresAt.toISOString(),
        input.idempotencyKey ?? null,
      ]
    );
    return rowToReviewItem(rows[0]);
  }

  async findById(id: string): Promise<ReviewItem | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM review_items WHERE id = $1', [id]
    );
    return rows[0] ? rowToReviewItem(rows[0]) : null;
  }

  async findByShortCode(shortCode: string): Promise<ReviewItem | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM review_items WHERE short_code = $1', [shortCode]
    );
    return rows[0] ? rowToReviewItem(rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<ReviewItem | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM review_items WHERE idempotency_key = $1', [key]
    );
    return rows[0] ? rowToReviewItem(rows[0]) : null;
  }

  async findOpenByJobGate(jobId: string, gateStep: string): Promise<ReviewItem | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM review_items
        WHERE job_id = $1 AND gate_step = $2
          AND status IN ('pending', 'edited')`,
      [jobId, gateStep]
    );
    return rows[0] ? rowToReviewItem(rows[0]) : null;
  }

  async update(
    id: string,
    data: Parameters<IReviewItemRepository['update']>[1],
    opts?: { expectedVersion?: number; expectedStatus?: ReviewItemStatus }
  ): Promise<ReviewItem> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const fieldMap: Record<string, string> = {
      status: 'status',
      resolution: 'resolution',
      renderState: 'render_state',
      version: 'version',
      decidedBy: 'decided_by',
      decidedVia: 'decided_via',
      decisionNote: 'decision_note',
      finalPayload: 'final_payload',
      payload: 'payload',
      notifiedAt: 'notified_at',
      firstOpenedAt: 'first_opened_at',
      decidedAt: 'decided_at',
      nextReminderAt: 'next_reminder_at',
      reminderCount: 'reminder_count',
      reminderSentAt: 'reminder_sent_at',
      customerNoticedAt: 'customer_noticed_at',
      supersedesId: 'supersedes_id',
      priority: 'priority',
    };

    const jsonFields = new Set(['finalPayload', 'payload']);

    for (const [key, col] of Object.entries(fieldMap)) {
      const val = (data as Record<string, unknown>)[key];
      if (val === undefined) continue;
      sets.push(`${col} = $${idx++}`);
      values.push(jsonFields.has(key) && val !== null ? JSON.stringify(val) : val);
    }

    // Always bump version on status transitions
    if ((data as Record<string, unknown>)['status'] !== undefined &&
        (data as Record<string, unknown>)['version'] === undefined) {
      sets.push(`version = version + 1`);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);
    const idParam = idx++;

    let whereClause = `WHERE id = $${idParam}`;
    if (opts?.expectedVersion !== undefined) {
      values.push(opts.expectedVersion);
      whereClause += ` AND version = $${idx++}`;
    }

    if (opts?.expectedStatus !== undefined) {
      values.push(opts.expectedStatus);
      whereClause += ` AND status = $${idx++} AND expires_at > NOW()`;
    }
    if (data.status === 'approved') {
      whereClause += " AND render_state IN ('none', 'done')";
    }
    const { rows, rowCount } = await this.db.query(
      `UPDATE review_items SET ${sets.join(', ')} ${whereClause} RETURNING *`,
      values
    );

    if (opts?.expectedVersion !== undefined && (rowCount ?? 0) === 0) {
      throw Object.assign(new Error('version_conflict'), { code: 'version_conflict' });
    }
    if (!rows[0]) throw new Error(`ReviewItem not found: ${id}`);
    return rowToReviewItem(rows[0]);
  }

  async listPending(filters?: {
    shopUserId?: string;
    typeKey?: string;
    status?: ReviewItemStatus[];
    limit?: number;
    afterId?: string;
  }): Promise<ReviewItem[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const statuses = filters?.status ?? ['pending', 'edited'];
    conditions.push(`status = ANY($${idx++}::text[])`);
    values.push(statuses);

    if (filters?.shopUserId) {
      conditions.push(`shop_user_id = $${idx++}`);
      values.push(filters.shopUserId);
    }
    if (filters?.typeKey) {
      conditions.push(`type_key = $${idx++}`);
      values.push(filters.typeKey);
    }

    const limit = filters?.limit ?? 50;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await this.db.query(
      `SELECT * FROM review_items ${where} ORDER BY due_at ASC LIMIT $${idx}`,
      [...values, limit]
    );
    return rows.map(rowToReviewItem);
  }

  async claimReminder(id: string, now: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE review_items SET reminder_sent_at=$2, next_reminder_at=NULL,
         reminder_count=reminder_count+1, updated_at=NOW()
       WHERE id=$1 AND status='pending' AND reminder_sent_at IS NULL AND expires_at > $2 RETURNING id`,
      [id, now.toISOString()]);
    return (result.rowCount ?? 0) > 0;
  }

  async listDueForReminder(now: Date): Promise<ReviewItem[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM review_items
        WHERE status = 'pending'
          AND reminder_sent_at IS NULL
          AND expires_at > $1
          AND COALESCE(next_reminder_at, created_at + ($2 * interval '1 hour')) <= $1
        ORDER BY next_reminder_at ASC LIMIT 100`,
      [now.toISOString(), Number(process.env.REVIEW_REMINDER_HOURS) > 0 ? Number(process.env.REVIEW_REMINDER_HOURS) : 12]
    );
    return rows.map(rowToReviewItem);
  }

  async listExpired(now: Date): Promise<ReviewItem[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM review_items
        WHERE status = 'pending'
          AND expires_at <= $1
        ORDER BY expires_at ASC LIMIT 100`,
      [now.toISOString()]
    );
    return rows.map(rowToReviewItem);
  }
}

function _generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
