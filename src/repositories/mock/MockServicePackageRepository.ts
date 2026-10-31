import { IServicePackageRepository } from '@/repositories/interfaces/IServicePackageRepository';
import {
  ServicePackage,
  PackageOrder,
  PackageUsage,
  PackageBalance,
} from '@/domain/models/ServicePackage';
import { PACKAGES } from '@/config/stripePackages';

function configToModel(cfg: (typeof PACKAGES)[number]): ServicePackage {
  return {
    code: cfg.code,
    nameTh: cfg.nameTh,
    priceBaht: cfg.priceBaht,
    clipsIncluded: cfg.clipsIncluded,
    revisionsPerClip: cfg.revisionsPerClip,
    maxDurationSeconds: cfg.maxDurationSeconds,
    ratiosIncluded: ['9:16'],
    includes: {},
    validDays: 30,
    stripePriceId: null,
    stripePaymentLink: cfg.paymentLinkUrl,
    active: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export class MockServicePackageRepository implements IServicePackageRepository {
  private orders: Map<string, PackageOrder>;
  private usages: Map<string, PackageUsage>;
  private seq = 0;

  constructor(
    orders?: Map<string, PackageOrder>,
    usages?: Map<string, PackageUsage>
  ) {
    this.orders = orders ?? new Map();
    this.usages = usages ?? new Map();
  }

  async findPackageByCode(code: string): Promise<ServicePackage | null> {
    const cfg = PACKAGES.find((p) => p.code === code);
    return cfg ? configToModel(cfg) : null;
  }

  async listActivePackages(): Promise<ServicePackage[]> {
    return PACKAGES.map(configToModel);
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
    const now = new Date();
    const order: PackageOrder = {
      id: crypto.randomUUID(),
      userId: input.userId,
      packageCode: input.packageCode,
      clipsIncluded: input.clipsIncluded,
      revisionsPerClip: input.revisionsPerClip,
      priceBaht: input.priceBaht,
      status: 'pending_payment',
      paidReference: null,
      stripeSessionId: input.stripeSessionId ?? null,
      startsAt: now,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    return { ...order };
  }

  async findOrderById(id: string): Promise<PackageOrder | null> {
    const o = this.orders.get(id);
    return o ? { ...o } : null;
  }

  async findActiveOrderByUser(userId: string): Promise<PackageOrder | null> {
    for (const o of this.orders.values()) {
      if (o.userId === userId && o.status === 'active') return { ...o };
    }
    return null;
  }

  async findOrderByStripeSession(sessionId: string): Promise<PackageOrder | null> {
    for (const o of this.orders.values()) {
      if (o.stripeSessionId === sessionId) return { ...o };
    }
    return null;
  }

  async updateOrderStatus(
    id: string,
    status: PackageOrder['status'],
    paidReference?: string
  ): Promise<void> {
    const o = this.orders.get(id);
    if (!o) return;
    this.orders.set(id, {
      ...o,
      status,
      paidReference: paidReference ?? o.paidReference,
      updatedAt: new Date(),
    });
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
    const usage: PackageUsage = {
      id: String(++this.seq),
      packageOrderId: input.packageOrderId,
      requestId: input.requestId,
      kind: input.kind,
      units: input.units ?? 1,
      reviewItemId: input.reviewItemId ?? null,
      extraPriceBaht: input.extraPriceBaht ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: new Date(),
    };
    this.usages.set(usage.id, usage);
    return { ...usage };
  }

  async getBalance(packageOrderId: string): Promise<PackageBalance> {
    const order = this.orders.get(packageOrderId);
    if (!order) throw new Error(`PackageOrder ${packageOrderId} not found`);
    const usages = [...this.usages.values()].filter(
      (u) => u.packageOrderId === packageOrderId
    );
    const clipsUsed = usages
      .filter((u) => u.kind === 'clip')
      .reduce((s, u) => s + u.units, 0);
    const clipsRefunded = usages
      .filter((u) => u.kind === 'refund_clip')
      .reduce((s, u) => s + u.units, 0);
    const netClips = clipsUsed - clipsRefunded;
    const revsByRequest: Record<string, number> = {};
    for (const u of usages) {
      if (u.kind === 'revision') {
        revsByRequest[u.requestId] = (revsByRequest[u.requestId] ?? 0) + u.units;
      }
    }
    return {
      orderId: packageOrderId,
      packageCode: order.packageCode,
      clipsIncluded: order.clipsIncluded,
      clipsUsed: netClips,
      clipsLeft: order.clipsIncluded - netClips,
      revisionsPerClip: order.revisionsPerClip,
      revisionsUsedByRequest: revsByRequest,
      status: order.status,
      expiresAt: order.expiresAt,
    };
  }

  async getRevisionCount(packageOrderId: string, requestId: string): Promise<number> {
    return [...this.usages.values()].filter(
      (u) =>
        u.packageOrderId === packageOrderId &&
        u.requestId === requestId &&
        u.kind === 'revision'
    ).reduce((s, u) => s + u.units, 0);
  }
}
