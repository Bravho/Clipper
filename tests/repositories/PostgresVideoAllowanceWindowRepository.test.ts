jest.mock("@/lib/db", () => ({ pool: { query: jest.fn() } }));

import { PostgresVideoAllowanceWindowRepository } from "@/repositories/postgres/PostgresVideoAllowanceWindowRepository";

/**
 * The purchase service's replay check calls createOrGetByPurchase with no
 * windows. Against Postgres that used to build `INSERT ... VALUES  ON CONFLICT`
 * — a syntax error — so every package checkout failed with "Purchase failed".
 */
describe("PostgresVideoAllowanceWindowRepository.createOrGetByPurchase", () => {
  function fakeDb(selectRows: unknown[] = []) {
    const query = jest.fn(async (sql: string) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: selectRows, rowCount: selectRows.length };
      return { rows: [], rowCount: 0 };
    });
    return { query };
  }

  it("a lookup with no windows only SELECTs and never issues an INSERT", async () => {
    const db = fakeDb();
    const repo = new PostgresVideoAllowanceWindowRepository(db as never);

    const result = await repo.createOrGetByPurchase({ purchaseId: "token-12345678", windows: [] });

    expect(result).toEqual({ windows: [], created: false });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/SELECT/);
  });

  it("still inserts when windows are given", async () => {
    const db = fakeDb();
    const repo = new PostgresVideoAllowanceWindowRepository(db as never);

    await repo.createOrGetByPurchase({
      purchaseId: "token-12345678",
      windows: [
        {
          userId: "u1",
          productCode: "video_1_month" as never,
          purchaseId: "token-12345678",
          sequence: 0,
          creditTransactionId: null,
          totalAllowance: 10,
          startsAt: new Date("2026-09-25T00:00:00Z"),
          expiresAt: new Date("2026-10-25T00:00:00Z"),
        },
      ],
    });

    const insert = db.query.mock.calls.find((c) => /INSERT INTO video_allowance_windows/.test(c[0] as string));
    expect(insert).toBeDefined();
    expect(insert![0]).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$6, \$7, \$8\)/);
  });
});
