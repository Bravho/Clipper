import {
  AdminRevenueService,
  buildRevenueReport,
  isProductionStoreEnvironment,
  storeRowToPayment,
  stripeRowToPayment,
  type PaymentRow,
} from "@/services/admin/AdminRevenueService";
import {
  applePriceFromTransaction,
  cleanClientPrice,
} from "@/services/MobileStorePurchaseService";

const RANGE = { from: new Date("2026-10-01T00:00:00+07:00"), to: new Date("2026-10-08T00:00:00+07:00") };

function pay(partial: Partial<PaymentRow>): PaymentRow {
  return {
    channel: "stripe_promptpay",
    userId: "u1",
    email: "u1@x",
    amount: 100,
    currency: "THB",
    credits: 100,
    product: "฿100 top-up",
    at: new Date("2026-10-03T05:00:00Z"),
    estimated: false,
    ...partial,
  };
}

function report(payments: PaymentRow[], first = new Map<string, Date>()) {
  return buildRevenueReport({
    range: RANGE,
    payments,
    stripeAttempts: [],
    firstPaymentAt: first,
    signupConversion: { newUsers: 0, paid: 0, medianDaysToFirstPayment: null },
    creditUse: [],
    storeTestPurchases: 0,
    commissionRate: 0.15,
  });
}

describe("store rows", () => {
  it("uses the recorded store price when there is one", () => {
    const p = storeRowToPayment({
      platform: "android",
      product_id: "com.rclipper.credits.500",
      price_amount: "649.00",
      price_currency: "thb",
      credits_granted: "500",
      user_id: "u",
      at: "2026-10-03T00:00:00Z",
    });
    expect(p).toMatchObject({ channel: "google_play", amount: 649, currency: "THB", estimated: false });
  });

  it("values an unpriced (pre-042) row at the catalogue's planned price and marks it estimated", () => {
    const p = storeRowToPayment({
      platform: "ios",
      product_id: "com.rclipper.credits.100",
      price_amount: null,
      credits_granted: 100,
      user_id: "u",
      at: "2026-10-03T00:00:00Z",
    });
    expect(p).toMatchObject({ channel: "app_store", amount: 130, currency: "THB", estimated: true });
  });

  it("treats only Production as revenue; Sandbox and Test are not", () => {
    expect(isProductionStoreEnvironment("Production")).toBe(true);
    expect(isProductionStoreEnvironment("Sandbox")).toBe(false);
    expect(isProductionStoreEnvironment("Test")).toBe(false);
    expect(isProductionStoreEnvironment(null)).toBe(false);
  });

  it("maps a Stripe card intent to the card channel with pg's string amount parsed", () => {
    const p = stripeRowToPayment({ method: "card", amount_baht: "1000.00", credits_to_add: "1000", user_id: "u", created_at: "2026-10-03T00:00:00Z" });
    expect(p).toMatchObject({ channel: "stripe_card", amount: 1000, credits: 1000 });
  });
});

describe("buildRevenueReport", () => {
  it("sums THB only, lists other currencies apart, and takes store commission off net", () => {
    const r = report([
      pay({ amount: 200 }),
      pay({ channel: "app_store", amount: 130, userId: "u2" }),
      pay({ channel: "app_store", amount: 1.99, currency: "USD", userId: "u3" }),
    ]);
    expect(r.totals.grossThb).toBe(330);
    expect(r.totals.netThb).toBe(310.5);
    const appStore = r.channels.find((c) => c.channel === "app_store")!;
    expect(appStore).toMatchObject({ payments: 2, grossThb: 130, netThb: 110.5 });
    expect(appStore.otherCurrencies).toEqual([{ currency: "USD", amount: 1.99, payments: 1 }]);
  });

  it("counts new payers by their first-ever payment, and repeat payers", () => {
    const r = report(
      [pay({ userId: "a" }), pay({ userId: "a" }), pay({ userId: "b" })],
      new Map([
        ["a", new Date("2026-09-01T00:00:00Z")],
        ["b", new Date("2026-10-03T05:00:00Z")],
      ])
    );
    expect(r.totals).toMatchObject({ payingUsers: 2, newPayers: 1, repeatPayers: 1, arppuThb: 150 });
  });

  it("fills every Bangkok day and puts a payment on its Bangkok date", () => {
    const r = report([pay({ at: new Date("2026-10-02T18:30:00Z"), amount: 50 })]); // 01:30 on 3 Oct in Bangkok
    expect(r.daily).toHaveLength(7);
    expect(r.daily.find((d) => d.date === "2026-10-03")?.total).toBe(50);
  });

  it("builds the Stripe checkout funnel with conversion and median minutes to pay", () => {
    const at = new Date("2026-10-03T00:00:00Z");
    const r = buildRevenueReport({
      range: RANGE,
      payments: [],
      stripeAttempts: [
        { method: "promptpay_qr", status: "paid", amount: 100, createdAt: at, updatedAt: new Date(at.getTime() + 120_000) },
        { method: "promptpay_qr", status: "expired", amount: 100, createdAt: at, updatedAt: at },
      ],
      firstPaymentAt: new Map(),
      signupConversion: { newUsers: 0, paid: 0, medianDaysToFirstPayment: null },
      creditUse: [],
      storeTestPurchases: 0,
    });
    expect(r.stripeFunnel[0]).toMatchObject({ label: "PromptPay QR", started: 2, paid: 1, expired: 1, paidPct: 50, medianMinutesToPay: 2 });
  });

  it("returns zeros and nulls, not NaN, with no payments", () => {
    const r = report([]);
    expect(r.totals).toMatchObject({ grossThb: 0, payingUsers: 0, arppuThb: null });
    expect(r.channels.every((c) => c.avgThb === null)).toBe(true);
  });
});

describe("store price capture", () => {
  it("reads Apple's milli-unit price and currency", () => {
    expect(applePriceFromTransaction({ price: 65000, currency: "THB" })).toEqual({ amount: 65, currency: "THB" });
    expect(applePriceFromTransaction({ price: 1990, currency: "usd" })).toEqual({ amount: 1.99, currency: "USD" });
    expect(applePriceFromTransaction({})).toBeNull();
  });

  it("keeps a plausible client price only", () => {
    expect(cleanClientPrice({ amount: 649, currency: "thb" })).toEqual({ amount: 649, currency: "THB" });
    expect(cleanClientPrice({ amount: -1, currency: "THB" })).toBeNull();
    expect(cleanClientPrice({ amount: 10, currency: "baht" })).toBeNull();
    expect(cleanClientPrice({ amount: undefined, currency: undefined })).toBeNull();
  });
});

describe("getReport", () => {
  it("selects NULL prices when migration 042 has not been applied", async () => {
    const calls: string[] = [];
    const db = {
      query: jest.fn(async (text: string) => {
        calls.push(text);
        if (text.includes("information_schema.columns")) return { rows: [] };
        return { rows: [] };
      }),
    };
    await new AdminRevenueService(db).getReport(RANGE);
    const store = calls.find((sql) => sql.includes("FROM mobile_store_purchases m\n    LEFT JOIN"))!;
    expect(store).toContain("NULL::numeric AS price_amount");
  });
});
