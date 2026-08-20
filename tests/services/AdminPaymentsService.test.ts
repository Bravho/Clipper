import {
  AdminPaymentsService,
  buildFunnel,
  buildRevenueSeries,
  csvField,
  toCsv,
  type MoneyEventRow,
} from "@/services/admin/AdminPaymentsService";
import { parseDateRange } from "@/features/admin/dateRange";

/**
 * AdminPaymentsService — the two ways this page can lie.
 *
 * 1. NUMERIC AND COUNT ARE STRINGS. `pg` returns int8 and numeric as strings
 *    because they do not round-trip through a JS number. Left unparsed they
 *    concatenate: "120" + "50" becomes ฿12,050 of revenue that never existed,
 *    and nothing throws. Every money assertion below is written against string
 *    inputs for exactly that reason.
 *
 * 2. `credit_purchase_logs` MAY NOT EXIST. It has no migration anywhere in the
 *    repository — only a repository class that reads it. An unguarded query
 *    takes down the whole payments page with `relation does not exist`.
 *
 * The pool is stubbed rather than mocked at module level: the service takes its
 * db through the constructor, so a plain object matching `query()` is enough
 * and no real socket is ever opened.
 */

type Rows = Record<string, unknown>[];

interface StubDb {
  query: jest.Mock<Promise<{ rows: Rows }>, [string, (unknown[] | undefined)?]>;
  /** Every SQL string the service issued, in order. */
  sql: string[];
}

/**
 * Build a fake pool that answers by matching the SQL against a pattern.
 *
 * Matching on a distinctive fragment rather than call order keeps the test
 * from breaking every time `Promise.all` is reordered — the queries are
 * independent, so their order is an implementation detail.
 */
function stubDb(handlers: Array<[RegExp, Rows | Error]>): StubDb {
  const sql: string[] = [];
  const query = jest.fn(async (text: string) => {
    sql.push(text);
    for (const [pattern, result] of handlers) {
      if (pattern.test(text)) {
        if (result instanceof Error) throw result;
        return { rows: result };
      }
    }
    return { rows: [] as Rows };
  });
  return { query, sql } as StubDb;
}

/** A three-day Bangkok window, so the daily spine is short enough to assert. */
const RANGE = parseDateRange({ from: "2026-08-01", to: "2026-08-03" });

/**
 * Everything a full `getSummary()` needs, with realistic `pg` types: counts and
 * numerics arrive as STRINGS, `::int` casts as numbers.
 */
const HAPPY_HANDLERS: Array<[RegExp, Rows]> = [
  // Funnel — COUNT(*)::int comes back as a number, SUM(numeric) as a string.
  [
    /GROUP BY status/,
    [
      { status: "paid", count: 3, baht: "1234.50" },
      { status: "expired", count: 2, baht: "300.00" },
      { status: "failed", count: 1, baht: "50.00" },
    ],
  ],
  [/percentile_cont/, [{ median_seconds: "96.5", paid_count: 3 }]],
  [
    /GROUP BY gateway, method/,
    [
      {
        gateway: "gbprimepay",
        method: "promptpay_qr",
        attempts: 5,
        paid: 3,
        paid_baht: "1234.50",
      },
    ],
  ],
  [
    /to_char\(created_at AT TIME ZONE/,
    [
      { day: "2026-08-01", baht: "1000.50" },
      { day: "2026-08-03", baht: "234.00" },
    ],
  ],
  [/COUNT\(DISTINCT pi\.user_id\)/, [{ paying_users: 2 }]],
  [
    /FROM credit_transactions/,
    [
      { type: "request_charge", count: 4, credits: -200 },
      { type: "request_refund", count: 1, credits: 50 },
      { type: "management_purchase", count: 2, credits: -350 },
      { type: "signup_bonus", count: 9, credits: 900 },
    ],
  ],
  [
    /COALESCE\(paid_at, created_at\) AT TIME ZONE/,
    [{ day: "2026-08-02", credits: 350 }],
  ],
  [/download_unlocked\)::int/, [{ requests: 10, unlocked: 4, trial: 6 }]],
  [
    /price_baht/,
    [
      {
        price_baht: "0",
        discount_baht: "0",
        amount_paid_baht: "0",
        priced_requests: 0,
      },
    ],
  ],
  [
    /FROM mobile_store_purchases/,
    [
      { platform: "ios", purchases: 2, credits_granted: 150 },
      { platform: "android", purchases: 1, credits_granted: 50 },
    ],
  ],
  [
    /LEFT JOIN management_products/,
    [
      {
        product_code: "management_single_video",
        product_name: "Single video",
        paid_count: 2,
        paid_credits: 100,
        refunded_count: 1,
        refunded_credits: 50,
        failed_count: 1,
        pending_count: 0,
        total_count: 4,
      },
    ],
  ],
  [/failure_reason, ''/, [{ reason: "insufficient_credits", count: 1 }]],
  [/FROM management_access_passes/, [{ active: 7, expiring_soon: 2 }]],
  [
    /FROM management_upload_bundles/,
    [
      {
        bundles: 3,
        total_allowance: 12,
        remaining: 5,
        expired_unused_bundles: 1,
        expired_unused_tokens: 3,
      },
    ],
  ],
  [/FROM credit_wallets/, [{ total_credits: 4200, wallets: 88 }]],
  [/to_regclass/, [{ present: false }]],
];

describe("AdminPaymentsService — numeric-string handling", () => {
  it("parses NUMERIC and COUNT strings into numbers instead of concatenating them", async () => {
    const db = stubDb(HAPPY_HANDLERS);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    // ฿1234.50 as a NUMBER. If the string survived, this would be "1234.50".
    expect(summary.headline.cashBaht).toBe(1234.5);
    expect(typeof summary.headline.cashBaht).toBe("number");

    // 3 + 2 + 1 intents. String concatenation would give 321 or "321".
    expect(summary.videoGeneration.funnel.created).toBe(6);
    expect(summary.videoGeneration.funnel.paid).toBe(3);
    expect(summary.videoGeneration.funnel.conversionPct).toBeCloseTo(50);

    // Expired ฿300 + failed ฿50 — an addition, not a "30050".
    expect(summary.videoGeneration.funnel.abandonedBaht).toBe(350);

    // percentile_cont returns float8, which pg may still hand over as a string.
    expect(summary.videoGeneration.funnel.medianSecondsToPay).toBeCloseTo(96.5);

    // ARPU divides a parsed number by a parsed count.
    expect(summary.headline.arpuBaht).toBeCloseTo(617.25);
  });

  it("nets credit charges against refunds across both product lines", async () => {
    const db = stubDb(HAPPY_HANDLERS);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    // 200 charged + 350 management − 50 refunded. The 900 signup bonus is
    // marketing cost and must not appear as spend.
    expect(summary.headline.creditsSpentNet).toBe(500);
    expect(summary.videoGeneration.creditsCharged).toBe(200);
    expect(summary.videoGeneration.creditsRefunded).toBe(50);
    expect(summary.videoGeneration.creditsNet).toBe(150);
  });

  it("keeps imputed mobile-store value out of the cash total", async () => {
    const db = stubDb(HAPPY_HANDLERS);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    // 150 + 50 credits, imputed at ฿1 each.
    expect(summary.videoGeneration.mobileStoreTotals.creditsGranted).toBe(200);
    expect(summary.videoGeneration.mobileStoreTotals.impliedBaht).toBe(200);

    // The cash tile is payment_intents alone — adding ฿200 of Apple/Google
    // credits here would invent revenue the business never received in THB.
    expect(summary.headline.cashBaht).toBe(1234.5);
  });

  it("derives bundle burn and refund rate from the raw counts", async () => {
    const db = stubDb(HAPPY_HANDLERS);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    expect(summary.channelManagement.bundles.burned).toBe(7); // 12 − 5
    expect(summary.channelManagement.bundles.burnPct).toBeCloseTo(58.33, 1);
    expect(summary.channelManagement.bundles.expiredUnusedTokens).toBe(3);

    // 1 refunded of 3 settled (2 paid + 1 refunded).
    expect(summary.channelManagement.totals.refundRatePct).toBeCloseTo(33.33, 1);
    expect(summary.channelManagement.byProduct[0].refundRatePct).toBeCloseTo(33.33, 1);
  });

  it("values the credit float as a liability at ฿1 per credit", async () => {
    const db = stubDb(HAPPY_HANDLERS);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    expect(summary.creditFloat.totalCredits).toBe(4200);
    expect(summary.creditFloat.liabilityBaht).toBe(4200);
    expect(summary.creditFloat.wallets).toBe(88);
  });
});

describe("AdminPaymentsService — credit_purchase_logs guard", () => {
  it("reports the section unavailable and never queries the table when to_regclass says it is absent", async () => {
    const db = stubDb(HAPPY_HANDLERS);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    expect(summary.videoGeneration.purchaseLog).toEqual({
      available: false,
      entries: 0,
      creditsAdded: 0,
      amountBaht: 0,
    });
    // The guard is only worth anything if it actually prevents the query.
    expect(db.sql.some((text) => /FROM credit_purchase_logs/.test(text))).toBe(false);
  });

  it("reads the table when to_regclass says it exists", async () => {
    const db = stubDb([
      ...HAPPY_HANDLERS.filter(([pattern]) => pattern.source !== /to_regclass/.source),
      [/to_regclass/, [{ present: true }]],
      [
        /FROM credit_purchase_logs/,
        [{ entries: 4, credits_added: 400, amount_baht: "400.00" }],
      ],
    ]);
    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    expect(summary.videoGeneration.purchaseLog).toEqual({
      available: true,
      entries: 4,
      creditsAdded: 400,
      amountBaht: 400,
    });
  });

  it("degrades the section rather than the page when the guarded query throws", async () => {
    const db = stubDb([
      ...HAPPY_HANDLERS.filter(([pattern]) => pattern.source !== /to_regclass/.source),
      // A permissions failure on the probe itself — the case a to_regclass
      // check alone does not cover.
      [/to_regclass/, new Error("permission denied for schema public")],
    ]);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const summary = await new AdminPaymentsService(db).getSummary(RANGE);

    // The rest of the report survives intact — that is the whole point.
    expect(summary.videoGeneration.purchaseLog.available).toBe(false);
    expect(summary.headline.cashBaht).toBe(1234.5);
    expect(summary.channelManagement.passes.active).toBe(7);

    errorSpy.mockRestore();
  });
});

describe("buildRevenueSeries", () => {
  it("fills days with no revenue so the line does not slope across a dead week", () => {
    const points = buildRevenueSeries(
      RANGE,
      [{ day: "2026-08-01", baht: "1000.50" }],
      [{ day: "2026-08-03", credits: 350 }]
    );

    expect(points.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(points[0].videoGenerationBaht).toBe(1000.5);
    expect(points[1].videoGenerationBaht).toBe(0);
    expect(points[1].channelManagementBaht).toBe(0);
    // Credits valued at ฿1 to share the axis — still not cash.
    expect(points[2].channelManagementBaht).toBe(350);
  });

  it("buckets on the Bangkok day string the SQL produced, not a UTC re-derivation", () => {
    // The range starts at Bangkok midnight on 1 Aug, which is 17:00 UTC on
    // 31 July. A naive UTC date would label this point "2026-07-31".
    const points = buildRevenueSeries(RANGE, [], []);
    expect(points[0].date).toBe("2026-08-01");
    expect(points).toHaveLength(3);
  });
});

describe("buildFunnel", () => {
  it("returns a null median when nothing settled, rather than a misleading zero", () => {
    const funnel = buildFunnel(
      [{ status: "expired", count: 4, baht: "400.00" }],
      0,
      { median_seconds: null, paid_count: 0 }
    );

    expect(funnel.medianSecondsToPay).toBeNull();
    expect(funnel.conversionPct).toBe(0);
    expect(funnel.created).toBe(4);
    expect(funnel.abandonedBaht).toBe(400);
  });

  it("counts unknown statuses toward created so conversion cannot be overstated", () => {
    // A status added to the table but not to this file must still inflate the
    // denominator; silently dropping it would make conversion look better.
    const funnel = buildFunnel(
      [
        { status: "paid", count: 1, baht: "100.00" },
        { status: "chargeback", count: 1, baht: "100.00" },
      ],
      10,
      { median_seconds: 10, paid_count: 1 }
    );

    expect(funnel.created).toBe(2);
    expect(funnel.conversionPct).toBe(50);
  });
});

describe("CSV export", () => {
  it("escapes commas, quotes and newlines so a description cannot shift the columns", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("Refund, partial")).toBe('"Refund, partial"');
    expect(csvField('Refund for "req-1"')).toBe('"Refund for ""req-1"""');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
    expect(csvField(42)).toBe("42");
  });

  it("defuses spreadsheet formulas hidden in free text", () => {
    // Excel would otherwise evaluate this cell on open.
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe(
      '"\'=HYPERLINK(""http://evil"")"'
    );
    expect(csvField("+1 credit")).toBe("'+1 credit");
  });

  it("writes a BOM, a header row and one line per event", () => {
    const rows: MoneyEventRow[] = [
      {
        occurredAt: "2026-08-01T03:00:00.000Z",
        source: "payment_intent",
        line: "video_generation",
        unit: "THB_CASH",
        userId: "u1",
        userEmail: "a@example.com",
        status: "paid",
        amountBaht: 50,
        amountCredits: 50,
        productCode: "",
        channel: "gbprimepay / promptpay_qr",
        reference: "RC-1",
        description: "Top-up of 50 credits",
      },
      {
        occurredAt: "2026-08-02T03:00:00.000Z",
        source: "credit_transaction",
        line: "channel_management",
        unit: "CREDITS",
        userId: "u1",
        userEmail: "a@example.com",
        status: "management_purchase",
        amountBaht: -50,
        amountCredits: -50,
        productCode: "",
        channel: "credit_wallet",
        reference: "",
        description: 'Unlock, "single video"',
      },
    ];

    const csv = toCsv(rows);
    const lines = csv.split("\r\n");

    // Excel on Windows needs the BOM or every Thai description is mojibake.
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe(
      "\uFEFFoccurred_at_utc,source,revenue_line,unit,amount_baht,amount_credits,status,product_code,channel,user_id,user_email,reference,description"
    );
    // Baht is fixed to two decimals so the column types as currency.
    expect(lines[1]).toContain("50.00");
    expect(lines[1]).toContain("THB_CASH");
    // The quote inside the description is doubled and the field wrapped.
    expect(lines[2]).toContain('"Unlock, ""single video"""');
    expect(lines[2]).toContain("CREDITS");
  });
});

describe("AdminPaymentsService.getMoneyEvents", () => {
  it("tags every source with its unit and orders the file by time", async () => {
    const db = stubDb([
      [
        /FROM payment_intents/,
        [
          {
            occurred_at: new Date("2026-08-02T04:00:00Z"),
            user_id: "u1",
            email: "a@example.com",
            status: "paid",
            amount_baht: "100.00",
            credits_to_add: 100,
            gateway: "gbprimepay",
            method: "promptpay_qr",
            reference_no: "RC-1",
          },
        ],
      ],
      [
        /FROM management_purchases/,
        [
          {
            occurred_at: new Date("2026-08-01T04:00:00Z"),
            user_id: "u1",
            email: "a@example.com",
            status: "paid",
            amount_credits: 50,
            product_code: "management_single_video",
            idempotency_key: "idem-1",
            failure_reason: null,
          },
        ],
      ],
      [
        /FROM mobile_store_purchases/,
        [
          {
            occurred_at: new Date("2026-08-03T04:00:00Z"),
            user_id: "u2",
            email: "b@example.com",
            platform: "ios",
            product_id: "credits_100",
            transaction_id: "txn-1",
            credits_granted: 100,
            store_environment: "production",
          },
        ],
      ],
      [/to_regclass/, [{ present: false }]],
    ]);

    const events = await new AdminPaymentsService(db).getMoneyEvents(RANGE);

    expect(events.map((e) => e.source)).toEqual([
      "management_purchase",
      "payment_intent",
      "mobile_store_purchase",
    ]);

    // Only the gateway row is cash. The other two are wallet movements and an
    // imputation of money Apple received — the unit column is what stops an
    // accountant summing all three.
    expect(events.map((e) => e.unit)).toEqual([
      "CREDITS",
      "THB_CASH",
      "CREDITS_IMPUTED",
    ]);
    expect(events[1].amountBaht).toBe(100);
    expect(events[0].line).toBe("channel_management");

    // Dates are normalised to ISO — pg hands back a JS Date whose default
    // toString neither sorts nor parses.
    expect(events[0].occurredAt).toBe("2026-08-01T04:00:00.000Z");
  });

  it("omits credit_purchase_logs rows entirely when the table is absent", async () => {
    const db = stubDb([[/to_regclass/, [{ present: false }]]]);
    const events = await new AdminPaymentsService(db).getMoneyEvents(RANGE);

    expect(events).toEqual([]);
    expect(db.sql.some((text) => /FROM credit_purchase_logs/.test(text))).toBe(false);
  });
});
