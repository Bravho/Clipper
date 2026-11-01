import { ServicePackage, PackageOrder, PackageUsage, PackageBalance } from '@/domain/models/ServicePackage';

export interface IServicePackageRepository {
  findPackageByCode(code: string): Promise<ServicePackage | null>;
  listActivePackages(): Promise<ServicePackage[]>;

  createOrder(input: {
    userId: string;
    packageCode: string;
    clipsIncluded: number;
    revisionsPerClip: number;
    priceBaht: number;
    stripeSessionId?: string;
    expiresAt: Date;
    isTest?: boolean;
    /** Insert active with this audit reference; reuse the scoped active balance atomically. */
    activationReference?: 'payment_disabled';
  }): Promise<PackageOrder>;
  findOrderById(id: string): Promise<PackageOrder | null>;
  findActiveOrderByUser(userId: string): Promise<PackageOrder | null>;
  findOrderByStripeSession(sessionId: string): Promise<PackageOrder | null>;
  updateOrderStatus(id: string, status: PackageOrder['status'], paidReference?: string): Promise<void>;

  recordUsage(input: {
    packageOrderId: string;
    requestId: string;
    kind: PackageUsage['kind'];
    units?: number;
    reviewItemId?: string;
    extraPriceBaht?: number;
    note?: string;
    createdBy?: string;
  }): Promise<PackageUsage>;
  getBalance(packageOrderId: string): Promise<PackageBalance>;
  getRevisionCount(packageOrderId: string, requestId: string): Promise<number>;
}
