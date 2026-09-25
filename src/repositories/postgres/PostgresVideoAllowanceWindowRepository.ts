import type { IVideoAllowanceWindowRepository } from "@/repositories/interfaces/IVideoAllowanceWindowRepository";
import type {
  VideoAllowanceWindow,
  CreateVideoAllowanceWindowInput,
} from "@/domain/models/VideoAllowanceWindow";
import { VideoAllowanceWindowStatus } from "@/domain/enums/VideoAllowanceStatus";
import type { VideoProductCode } from "@/domain/enums/VideoProductCode";
import { pool } from "@/lib/db";

function rowToWindow(row: Record<string, unknown>): VideoAllowanceWindow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    productCode: row.product_code as VideoProductCode,
    purchaseId: row.purchase_id as string,
    sequence: Number(row.sequence ?? 0),
    creditTransactionId: (row.credit_transaction_id as string) ?? null,
    totalAllowance: Number(row.total_allowance ?? 0),
    remaining: Number(row.remaining ?? 0),
    startsAt: new Date(row.starts_at as string),
    expiresAt: new Date(row.expires_at as string),
    status: row.status as VideoAllowanceWindowStatus,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/** Active, started, not elapsed, with requests left. */
const SPENDABLE = `
  status = 'active'
  AND remaining > 0
  AND starts_at <= $2
  AND expires_at > $2
`;

export class PostgresVideoAllowanceWindowRepository
  implements IVideoAllowanceWindowRepository
{
  constructor(private db = pool) {}

  async createOrGetByPurchase(input: {
    purchaseId: string;
    windows: CreateVideoAllowanceWindowInput[];
  }): Promise<{ windows: VideoAllowanceWindow[]; created: boolean }> {
    // Replay safety: UNIQUE(purchase_id, sequence) means a double-clicked
    // checkout inserts nothing the second time. Checking first (rather than
    // relying on ON CONFLICT alone) lets the caller know whether IT granted the
    // months, which is what decides if the credits should be debited.
    const existing = await this.db.query(
      `SELECT * FROM video_allowance_windows
        WHERE purchase_id = $1
        ORDER BY sequence`,
      [input.purchaseId]
    );
    if (existing.rows.length > 0) {
      return { windows: existing.rows.map(rowToWindow), created: false };
    }

    // A lookup-only call (the purchase service's replay check passes no
    // windows) must stop here: an INSERT with an empty VALUES list is a SQL
    // syntax error, which made every package checkout 500 "Purchase failed".
    if (input.windows.length === 0) {
      return { windows: [], created: false };
    }

    const values: unknown[] = [];
    const tuples = input.windows.map((w, i) => {
      const base = i * 8;
      values.push(
        w.userId,
        w.productCode,
        w.purchaseId,
        w.sequence,
        w.creditTransactionId,
        w.totalAllowance,
        w.startsAt,
        w.expiresAt
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 6}, $${base + 7}, $${base + 8})`;
    });

    const { rows } = await this.db.query(
      `INSERT INTO video_allowance_windows
         (user_id, product_code, purchase_id, sequence, credit_transaction_id,
          total_allowance, remaining, starts_at, expires_at)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (purchase_id, sequence) DO NOTHING
       RETURNING *`,
      values
    );

    // A lost race (another request inserted first) returns no rows; read back
    // the winner's so the caller still gets the granted months.
    if (rows.length === 0) {
      const raced = await this.db.query(
        `SELECT * FROM video_allowance_windows
          WHERE purchase_id = $1 ORDER BY sequence`,
        [input.purchaseId]
      );
      return { windows: raced.rows.map(rowToWindow), created: false };
    }

    return { windows: rows.map(rowToWindow), created: true };
  }

  async findById(id: string): Promise<VideoAllowanceWindow | null> {
    const { rows } = await this.db.query(
      "SELECT * FROM video_allowance_windows WHERE id = $1",
      [id]
    );
    return rows[0] ? rowToWindow(rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<VideoAllowanceWindow[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM video_allowance_windows
        WHERE user_id = $1 ORDER BY starts_at`,
      [userId]
    );
    return rows.map(rowToWindow);
  }

  async findSpendable(
    userId: string,
    now: Date
  ): Promise<VideoAllowanceWindow | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM video_allowance_windows
        WHERE user_id = $1 AND ${SPENDABLE}
        ORDER BY expires_at
        LIMIT 1`,
      [userId, now]
    );
    return rows[0] ? rowToWindow(rows[0]) : null;
  }

  async latestExpiry(userId: string, now: Date): Promise<Date | null> {
    const { rows } = await this.db.query(
      `SELECT MAX(expires_at) AS latest
         FROM video_allowance_windows
        WHERE user_id = $1 AND status = 'active' AND expires_at > $2`,
      [userId, now]
    );
    const latest = rows[0]?.latest;
    return latest ? new Date(latest as string) : null;
  }

  async consumeOne(userId: string, now: Date): Promise<string | null> {
    // One statement: pick the oldest-expiring spendable window and decrement it
    // under a row lock. `remaining > 0` inside the UPDATE is the real guard, so
    // two submissions racing for a month's last request cannot both win.
    const { rows } = await this.db.query(
      `WITH target AS (
         SELECT id FROM video_allowance_windows
          WHERE user_id = $1 AND ${SPENDABLE}
          ORDER BY expires_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE video_allowance_windows w
          SET remaining = w.remaining - 1,
              updated_at = NOW()
         FROM target
        WHERE w.id = target.id AND w.remaining > 0
       RETURNING w.id`,
      [userId, now]
    );
    return (rows[0]?.id as string) ?? null;
  }

  async refundOne(windowId: string): Promise<void> {
    // Capped at the allowance and restricted to a live window: a double refund
    // cannot manufacture requests, and an elapsed month is not resurrected.
    await this.db.query(
      `UPDATE video_allowance_windows
          SET remaining = remaining + 1, updated_at = NOW()
        WHERE id = $1
          AND status = 'active'
          AND remaining < total_allowance
          AND expires_at > NOW()`,
      [windowId]
    );
  }

  async markElapsedExpired(now: Date): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE video_allowance_windows
          SET status = 'expired', updated_at = NOW()
        WHERE status = 'active' AND expires_at <= $1`,
      [now]
    );
    return rowCount ?? 0;
  }
}
