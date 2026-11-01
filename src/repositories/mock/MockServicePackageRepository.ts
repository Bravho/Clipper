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
    isTest?: boolean;
    activationReference?: 'payment_disabled';
  }): Promise<PackageOrder> {
    // No await before insertion: concurrent mock calls observe the inserted balance.
    const active = input.activationReference && [...this.orders.values()].find(o =>
      o.userId === input.userId && o.isTest === (input.isTest ?? false) && o.status === 'active' &&
      o.expiresAt > new Date() && o.clipsIncluded > [...this.usages.values()]
        .filter(u => u.packageOrderId === o.id).reduce((n,u) => n + (u.kind === 'clip' ? u.units : u.kind === 'refund_clip' ? -u.units : 0), 0));
    if (active) return { ...active };
    const pending = !input.activationReference && [...this.orders.values()].find(o => o.userId === input.userId &&
      o.packageCode === input.packageCode && o.isTest === (input.isTest ?? false) &&
      o.status === 'pending_payment' && o.expiresAt > new Date());
    if (pending) return { ...pending };
    const now = new Date();
    const order: PackageOrder = {
      id: crypto.randomUUID(),
      userId: input.userId,
      packageCode: input.packageCode,
      clipsIncluded: input.clipsIncluded,
      revisionsPerClip: input.revisionsPerClip,
      priceBaht: input.priceBaht,
      status: input.activationReference ? 'active' : 'pending_payment',
      paidReference: input.activationReference ?? null,
      stripeSessionId: input.stripeSessionId ?? null,
      startsAt: now,
      expiresAt: input.expiresAt,
      isTest: input.isTest ?? false,
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

  async findActiveOrderByUser(userId: string, isTest = process.env.LINE_TEST_MODE === 'true'): Promise<PackageOrder | null> {
    for (const o of [...this.orders.values()].sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      if (o.userId === userId && o.status === 'active' && o.expiresAt > new Date() &&
        (o.isTest === isTest) && (await this.getBalance(o.id)).clipsLeft > 0) return { ...o };
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
    if (input.kind === 'revision') {
      const used = [...this.usages.values()].filter(u => u.packageOrderId === input.packageOrderId &&
        u.requestId === input.requestId && u.kind === 'revision').reduce((sum,u) => sum + u.units,0);
      if (used + (input.units ?? 1) > 2) throw new Error('max_revisions_exceeded');
    }
    if (input.kind === 'clip') {
      const existing = [...this.usages.values()].find(u => u.requestId === input.requestId && u.kind === 'clip');
      if (existing) return { ...existing };
    }
    if (input.kind === 'clip' && (await this.getBalance(input.packageOrderId)).clipsLeft < (input.units ?? 1)) throw new Error('package_exhausted');
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
