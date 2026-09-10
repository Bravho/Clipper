/**
 * Bundle purchases: one debit, two entitlements, one transaction.
 *
 * A bundle is the only product that grants two different things, so the risk it
 * carries is unique — a buyer ending up with a publishing pass but no video
 * allowance, or the reverse, after paying once. These tests drive the service
 * against a fake PoolClient that records every statement, so they can assert the
 * thing that actually matters: both grants land BETWEEN the same BEGIN and
 * COMMIT as the wallet debit, so there is no window in which one exists without
 * the other.
 */

import { ManagementPurchaseService } from "@/services/management/ManagementPurchaseService";
import { findManagementProduct } from "@/config/management";
import { REQUESTS_PER_PAID_MONTH } from "@/config/videoPackages";
import { ManagementPurchaseStatus } from "@/domain/models/ManagementPurchase";
import type { ManagementProductCode } from "@/domain/enums/ManagementProductCode";

const USER = "user-1";
const PURCHASE_ID = "purchase-1";

interface Recorded {
  sql: string;
  params: unknown[];
}

function productRow(code: ManagementProductCode) {
  const def = findManagementProduct(code)!;
  return {
    id: `product-${code}`,
    code: def.code,
    name: def.code,
    description: "",
    productType: def.productType,
    durationMonths: def.durationMonths,
    uploadAllowance: def.uploadAllowance,
    accessWindowDays: def.accessWindowDays,
    videoMonths: def.videoMonths,
    priceCredits: def.launchPriceCredits,
    fullPriceCredits: def.fullPriceCredits,
    currency: "THB",
    isActive: true,
    sortOrder: def.sortOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function build(code: ManagementProductCode, opts: { balance?: number } = {}) {
  const log: Recorded[] = [];
  const balance = opts.balance ?? 100_000;

  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("FROM credit_wallets"))
        return { rows: [{ id: "wallet-1", balance }] };
      if (sql.includes("UPDATE credit_wallets"))
        return { rows: [{ balance: balance - productRow(code).priceCredits }] };
      if (sql.includes("INSERT INTO credit_transactions"))
        return { rows: [{ id: "ctx-1" }] };
      if (sql.includes("INSERT INTO management_access_passes"))
        return { rows: [{ id: "pass-1" }] };
      if (sql.includes("INSERT INTO management_upload_bundles"))
        return { rows: [{ id: "bundle-1" }] };
      // Both "current expiry" reads return empty: no live time to stack onto.
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const purchase = {
    id: PURCHASE_ID,
    userId: USER,
    managementProductId: productRow(code).id,
    productCode: code,
    managementContentId: null,
    status: ManagementPurchaseStatus.Pending,
    amountCredits: productRow(code).priceCredits,
    currency: "THB",
    idempotencyKey: "key-1",
    creditTransactionId: null,
    paidAt: null,
    failureReason: null,
    refundedAt: null,
    refundCreditTransactionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const service = new ManagementPurchaseService(
    { connect: async () => client, query: async () => ({ rows: [{ balance }] }) } as never,
    { findByCode: async () => productRow(code) } as never,
    {
      createOrGetByIdempotencyKey: async () => ({ purchase, created: true }),
      updateStatus: jest.fn(),
      findById: async () => purchase,
    } as never,
    {
      findByPurchaseId: async () => ({
        id: "pass-1",
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    } as never,
    { findByPurchaseId: async () => null } as never,
    { enqueue: jest.fn() } as never,
    { record: jest.fn() } as never
  );

  return { service, client, log };
}

const videoInserts = (log: Recorded[]) =>
  log.filter((e) => e.sql.includes("INSERT INTO video_allowance_windows"));

describe("bundle purchase", () => {
  it("grants a publishing pass AND video months from one debit", async () => {
    const { service, log } = build("management_bundle_3_months");
    const result = await service.purchase({ userId: USER, productCode: "management_bundle_3_months" });

    expect(result.charged).toBe(true);
    expect(result.videoMonthsGranted).toBe(3);
    expect(result.videoActiveUntil).toBeInstanceOf(Date);

    // Exactly one pass, exactly one wallet debit, one row per video month.
    expect(log.filter((e) => e.sql.includes("INSERT INTO management_access_passes"))).toHaveLength(1);
    expect(log.filter((e) => e.sql.includes("UPDATE credit_wallets"))).toHaveLength(1);
    expect(videoInserts(log)).toHaveLength(3);
  });

  it("writes both grants inside the same transaction as the debit", async () => {
    const { service, log } = build("management_bundle_6_months");
    await service.purchase({ userId: USER, productCode: "management_bundle_6_months" });

    const at = (needle: string) => log.findIndex((e) => e.sql.includes(needle));
    const begin = at("BEGIN");
    const commit = at("COMMIT");
    const debit = at("UPDATE credit_wallets");
    const pass = at("INSERT INTO management_access_passes");
    const video = at("INSERT INTO video_allowance_windows");

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThan(begin);
    for (const idx of [debit, pass, video]) {
      expect(idx).toBeGreaterThan(begin);
      expect(idx).toBeLessThan(commit);
    }
  });

  it("gives each video month the standard monthly allowance", async () => {
    const { service, log } = build("management_bundle_1_month");
    await service.purchase({ userId: USER, productCode: "management_bundle_1_month" });

    const [insert] = videoInserts(log);
    // params: userId, productCode, purchaseId, sequence, ctxId, allowance, startsAt, expiresAt
    expect(insert.params[0]).toBe(USER);
    expect(insert.params[2]).toBe(PURCHASE_ID);
    expect(insert.params[3]).toBe(0);
    expect(insert.params[5]).toBe(REQUESTS_PER_PAID_MONTH);
    expect(insert.sql).toContain("ON CONFLICT (purchase_id, sequence) DO NOTHING");
  });

  it("lays a 12-month bundle out as twelve consecutive windows", async () => {
    const { service, log } = build("management_bundle_1_year");
    const result = await service.purchase({ userId: USER, productCode: "management_bundle_1_year" });

    const inserts = videoInserts(log);
    expect(inserts).toHaveLength(12);
    expect(result.videoMonthsGranted).toBe(12);

    // Consecutive and non-overlapping: month N ends exactly where N+1 begins,
    // which is what makes the allowance non-aggregating.
    for (let i = 1; i < inserts.length; i++) {
      const prevEnd = (inserts[i - 1].params[7] as Date).getTime();
      const thisStart = (inserts[i].params[6] as Date).getTime();
      expect(thisStart).toBe(prevEnd);
    }
  });

  it("grants NO video months for a publishing-only pass", async () => {
    const { service, log } = build("management_access_3_months");
    const result = await service.purchase({ userId: USER, productCode: "management_access_3_months" });

    expect(videoInserts(log)).toHaveLength(0);
    expect(result.videoMonthsGranted).toBeNull();
    expect(result.videoActiveUntil).toBeNull();
  });

  it("grants nothing at all when the wallet is short", async () => {
    const { service, log } = build("management_bundle_1_year", { balance: 10 });
    await expect(
      service.purchase({ userId: USER, productCode: "management_bundle_1_year" })
    ).rejects.toThrow(/Insufficient credits/);

    expect(videoInserts(log)).toHaveLength(0);
    expect(log.filter((e) => e.sql.includes("INSERT INTO management_access_passes"))).toHaveLength(0);
    expect(log.some((e) => e.sql.includes("ROLLBACK"))).toBe(true);
  });
});
