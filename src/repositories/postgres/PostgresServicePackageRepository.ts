import { IServicePackageRepository } from '@/repositories/interfaces/IServicePackageRepository';
import {
  ServicePackage,
  PackageOrder,
  PackageUsage,
  PackageBalance,
} from '@/domain/models/ServicePackage';
import { pool } from '@/lib/db';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value as string) as T; } catch { return fallback; }
}

function rowToPackage(row: Record<string, unknown>): ServicePackage {
  return {
    code: row.code as string,
    nameTh: row.name_th as string,
    priceBaht: parseFloat(row.price_baht as string),
    clipsIncluded: Number(row.clips_included),
    revisionsPerClip: Number(row.revisions_per_clip ?? 2),
    maxDurationSeconds: Number(row.max_duration_seconds ?? 90),
    ratiosIncluded: (row.ratios_included as string[]) ?? ['9:16'],
    includes: parseJson(row.includes, {}),
    validDays: Number(row.valid_days ?? 30),
    stripePriceId: (row.stripe_price_id as string) ?? null,
    stripePaymentLink: (row.stripe_payment_link as string) ?? null,
    active: Boolean(row.active),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToOrder(row: Record<string, unknown>): PackageOrder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    packageCode: row.package_code as string,
    clipsIncluded: Number(row.clips_included),
    revisionsPerClip: Number(row.revisions_per_clip ?? 2),
    priceBaht: parseFloat(row.price_baht as string),
    status: row.status as PackageOrder['status'],
    paidReference: (row.paid_reference as string) ?? null,
    stripeSessionId: (row.stripe_session_id as string) ?? null,
    startsAt: new Date(row.starts_at as string),
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToUsage(row: Record<string, unknown>): PackageUsage {
  return {
    id: String(row.id),
    packageOrderId: row.package_order_id as string,
    requestId: row.request_id as string,
    kind: row.kind as PackageUsage['kind'],
    units: Number(row.units ?? 1),
    reviewItemId: (row.review_item_id as string) ?? null,
    extraPriceBaht: row.extra_price_baht != null ? parseFloat(row.extra_price_baht as string) : null,
    note: (row.note as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export class PostgresServicePackageRepository implements IServicePackageRepository {
  constructor(private db = pool) {}

  async findPackageByCode(code: string): Promise<ServicePackage | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM service_packages WHERE code=$1', [code]
    );
    return rows[0] ? rowToPackage(rows[0]) : null;
  }

  async listActivePackages(): Promise<ServicePackage[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM service_packages WHERE active=TRUE ORDER BY price_baht ASC'
    );
    return rows.map(rowToPackage);
  }

  async createOrder(input: {
    userId: string;
    packageCode: string;
    clipsIncluded: number;
    revisionsPerClip: number;
    priceBaht: number;
    stripeSessionId?: string;
    expiresAt: Date;
  }): Promise<PackageOrder> {
    const { rows } = await this.db.query(
      `INSERT INTO package_orders
         (user_id, package_code, clips_included, revisions_per_clip, price_baht,
          stripe_session_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        input.userId,
        input.packageCode,
        input.clipsIncluded,
        input.revisionsPerClip,
        input.priceBaht,
        input.stripeSessionId ?? null,
        input.expiresAt.toISOString(),
      ]
    );
    return rowToOrder(rows[0]);
  }

  async findOrderById(id: string): Promise<PackageOrder | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM package_orders WHERE id=$1', [id]
    );
    return rows[0] ? rowToOrder(rows[0]) : null;
  }

  async findActiveOrderByUser(userId: string): Promise<PackageOrder | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM package_orders
        WHERE user_id=$1 AND status='active' AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] ? rowToOrder(rows[0]) : null;
  }

  async findOrderByStripeSession(sessionId: string): Promise<PackageOrder | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM package_orders WHERE stripe_session_id=$1 LIMIT 1',
      [sessionId]
    );
    return rows[0] ? rowToOrder(rows[0]) : null;
  }

  async updateOrderStatus(id: string, status: PackageOrder['status'], paidReference?: string): Promise<void> {
    await this.db.query(
      `UPDATE package_orders SET status=$2, paid_reference=COALESCE($3, paid_reference), updated_at=NOW()
       WHERE id=$1`,
      [id, status, paidReference ?? null]
    );
  }

  async recordUsage(input: {
    packageOrderId: string;
    requestId: string;
    kind: PackageUsage['kind'];
    units?: number;
    reviewItemId?: string;
    extraPriceBaht?: number;
    note?: string;
    createdBy?: string;
  }): Promise<PackageUsage> {
    const { rows } = await this.db.query(
      `INSERT INTO package_usage
         (package_order_id, request_id, kind, units, review_item_id, extra_price_baht, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.packageOrderId,
        input.requestId,
        input.kind,
        input.units ?? 1,
        input.reviewItemId ?? null,
        input.extraPriceBaht ?? null,
        input.note ?? null,
        input.createdBy ?? null,
      ]
    );
    return rowToUsage(rows[0]);
  }

  async getBalance(packageOrderId: string): Promise<PackageBalance> {
    const order = await this.findOrderById(packageOrderId);
    if (!order) throw new Error(`PackageOrder not found: ${packageOrderId}`);

    const { rows } = await this.db.query(
      `SELECT kind, SUM(units) AS total
         FROM package_usage WHERE package_order_id=$1
         GROUP BY kind`,
      [packageOrderId]
    );

    let clipsUsed = 0;
    const revisionsUsedByRequest: Record<string, number> = {};

    for (const row of rows) {
      const kind = row.kind as PackageUsage['kind'];
      const total = Number(row.total ?? 0);
      if (kind === 'clip') clipsUsed += total;
      if (kind === 'refund_clip') clipsUsed -= total;
    }

    const { rows: revRows } = await this.db.query(
      `SELECT request_id, SUM(units) AS total
         FROM package_usage
        WHERE package_order_id=$1 AND kind='revision'
        GROUP BY request_id`,
      [packageOrderId]
    );
    for (const row of revRows) {
      revisionsUsedByRequest[row.request_id as string] = Number(row.total ?? 0);
    }

    return {
      orderId: order.id,
      packageCode: order.packageCode,
      clipsIncluded: order.clipsIncluded,
      clipsUsed,
      clipsLeft: order.clipsIncluded - clipsUsed,
      revisionsPerClip: order.revisionsPerClip,
      revisionsUsedByRequest,
      status: order.status,
      expiresAt: order.expiresAt,
    };
  }

  async getRevisionCount(packageOrderId: string, requestId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COALESCE(SUM(units), 0)::int AS total
         FROM package_usage
        WHERE package_order_id=$1 AND request_id=$2 AND kind='revision'`,
      [packageOrderId, requestId]
    );
    return Number(rows[0]?.total ?? 0);
  }
}
