export type PackageOrderStatus =
  | 'pending_payment'
  | 'active'
  | 'used_up'
  | 'expired'
  | 'cancelled';

export type PackageUsageKind =
  | 'clip'
  | 'revision'
  | 'extra'
  | 'refund_clip'
  | 'refund_revision';

export interface ServicePackage {
  code: string;
  nameTh: string;
  priceBaht: number;
  clipsIncluded: number;
  revisionsPerClip: number;
  maxDurationSeconds: number;
  ratiosIncluded: string[];
  includes: Record<string, unknown>;
  validDays: number;
  stripePriceId: string | null;
  stripePaymentLink: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackageOrder {
  id: string;
  userId: string;
  packageCode: string;
  clipsIncluded: number;
  revisionsPerClip: number;
  priceBaht: number;
  status: PackageOrderStatus;
  paidReference: string | null;
  stripeSessionId: string | null;
  startsAt: Date;
  expiresAt: Date;
  /** True when this order was created during a LINE test run (migration 054). */
  isTest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackageUsage {
  id: string;
  packageOrderId: string;
  requestId: string;
  kind: PackageUsageKind;
  units: number;
  reviewItemId: string | null;
  extraPriceBaht: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface PackageBalance {
  orderId: string;
  packageCode: string;
  clipsIncluded: number;
  clipsUsed: number;
  clipsLeft: number;
  revisionsPerClip: number;
  revisionsUsedByRequest: Record<string, number>;
  status: PackageOrderStatus;
  expiresAt: Date;
}
