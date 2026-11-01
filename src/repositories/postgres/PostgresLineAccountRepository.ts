import { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';
import { LineAccount, LineConversationState } from '@/domain/models/LineAccount';
import { pool } from '@/lib/db';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value as string) as T; } catch { return fallback; }
}

function rowToAccount(row: Record<string, unknown>): LineAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    lineChannelId: row.line_channel_id as string,
    lineUserId: row.line_user_id as string,
    displayName: (row.display_name as string) ?? null,
    linkedVia: row.linked_via as LineAccount['linkedVia'],
    status: row.status as LineAccount['status'],
    takeoverActive: Boolean(row.takeover_active),
    takeoverExpiresAt: row.takeover_expires_at ? new Date(row.takeover_expires_at as string) : null,
    isTest: Boolean(row.is_test),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresLineAccountRepository implements ILineAccountRepository {
  constructor(private db = pool) {}

  async beginUpload(channel: string, user: string): Promise<boolean> {
    const { rows } = await this.db.query(`UPDATE line_conversation_states
      SET context=jsonb_set(context, '{pendingUploads}', to_jsonb(COALESCE((context->>'pendingUploads')::int,0)+1)), updated_at=NOW()
      WHERE line_channel_id=$1 AND line_user_id=$2 AND state='awaiting_files' RETURNING state`, [channel,user]);
    return rows.length > 0;
  }
  async finishUpload(channel: string, user: string, file?: { storageKey: string; fileSizeBytes: number }): Promise<{ count: number; pending: number } | null> {
    const { rows } = await this.db.query(`UPDATE line_conversation_states SET context=
      jsonb_set(jsonb_set(context, '{files}', CASE WHEN $3::jsonb IS NOT NULL
        AND jsonb_array_length(COALESCE(context->'files','[]'::jsonb)) < 20
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(context->'files','[]'::jsonb)) f
          WHERE f->>'storageKey'=($3::jsonb)->>'storageKey' OR f #>> '{}'=($3::jsonb)->>'storageKey')
        THEN COALESCE(context->'files','[]'::jsonb) || jsonb_build_array($3::jsonb)
        ELSE COALESCE(context->'files','[]'::jsonb) END),
        '{pendingUploads}', to_jsonb(GREATEST(0,COALESCE((context->>'pendingUploads')::int,0)-1))), updated_at=NOW()
      WHERE line_channel_id=$1 AND line_user_id=$2 AND state='awaiting_files'
      RETURNING jsonb_array_length(context->'files') AS count, (context->>'pendingUploads')::int AS pending`,
      [channel,user,file ? JSON.stringify(file) : null]);
    return rows[0] ?? null;
  }
  async claimSubmission(channel: string, user: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.db.query(`UPDATE line_conversation_states SET state='submitting', updated_at=NOW()
      WHERE line_channel_id=$1 AND line_user_id=$2 AND state='awaiting_files'
      AND COALESCE((context->>'pendingUploads')::int,0)=0
      AND jsonb_array_length(COALESCE(context->'files','[]'::jsonb))>0 RETURNING context`, [channel,user]);
    return rows[0] ? parseJson(rows[0].context, {}) : null;
  }

  async findByLineUser(lineChannelId: string, lineUserId: string): Promise<LineAccount | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM line_accounts WHERE line_channel_id=$1 AND line_user_id=$2',
      [lineChannelId, lineUserId]
    );
    return rows[0] ? rowToAccount(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<LineAccount[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM line_accounts WHERE user_id=$1 ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(rowToAccount);
  }

  async create(input: Omit<LineAccount, 'id' | 'createdAt' | 'updatedAt' | 'takeoverActive' | 'takeoverExpiresAt'>): Promise<LineAccount> {
    const { rows } = await this.db.query(
      `INSERT INTO line_accounts (user_id, line_channel_id, line_user_id, display_name, linked_via, status, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.userId,
        input.lineChannelId,
        input.lineUserId,
        input.displayName ?? null,
        input.linkedVia,
        input.status,
        input.isTest ?? false,
      ]
    );
    return rowToAccount(rows[0]);
  }

  async updateStatus(id: string, status: LineAccount['status']): Promise<void> {
    await this.db.query(
      'UPDATE line_accounts SET status=$2, updated_at=NOW() WHERE id=$1',
      [id, status]
    );
  }

  async setTakeover(id: string, active: boolean, expiresAt: Date | null): Promise<void> {
    await this.db.query(
      'UPDATE line_accounts SET takeover_active=$2, takeover_expires_at=$3, updated_at=NOW() WHERE id=$1',
      [id, active, expiresAt ?? null]
    );
  }

  async getConversationState(
    lineChannelId: string,
    lineUserId: string
  ): Promise<LineConversationState | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM line_conversation_states WHERE line_channel_id=$1 AND line_user_id=$2',
      [lineChannelId, lineUserId]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      lineUserId: row.line_user_id as string,
      lineChannelId: row.line_channel_id as string,
      state: row.state as string,
      context: parseJson(row.context, {}),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  async upsertConversationState(
    lineChannelId: string,
    lineUserId: string,
    state: string,
    context: Record<string, unknown>
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO line_conversation_states (line_channel_id, line_user_id, state, context, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (line_channel_id, line_user_id)
       DO UPDATE SET state=$3, context=$4, updated_at=NOW()`,
      [lineChannelId, lineUserId, state, JSON.stringify(context)]
    );
  }
}
