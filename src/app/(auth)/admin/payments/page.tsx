import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartFrame, ChartEmpty } from "@/features/admin/charts/ChartFrame";
import { TimeSeriesChart } from "@/features/admin/charts/TimeSeriesChart";
import { adminPaymentsService } from "@/services/admin/AdminPaymentsService";

export const metadata: Metadata = { title: "Payments — Admin" };

/**
 * Admin payments summary — both revenue lines side by side.
 *
 * The page's central job is NOT to show a big number. It is to stop anyone
 * reading a credit figure as cash. Only `payment_intents.amount_baht` is money
 * the business received; Channel Management is paid from wallets, and the
 * mobile stores never tell us their price at all. Every tile, table and chart
 * here therefore carries its unit in the label, and the banner below the
 * heading says it once in plain words.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(Role.Admin);

  const params = await searchParams;
  const range = parseDateRange(params);
  const summary = await adminPaymentsService.getSummary(range);

  const { headline, videoGeneration: vg, channelManagement: cm } = summary;
  const exportHref = `/api/admin/payments/export?from=${range.fromInput}&to=${range.toInput}`;

  const hasRevenue = summary.revenueSeries.some(
    (point) => point.videoGenerationBaht > 0 || point.channelManagementBaht > 0
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            Revenue across both lines — video generation top-ups and Channel Management.
          </p>
        </div>
        <a
          href={exportHref}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      <DateRangeBar
        fromInput={range.fromInput}
        toInput={range.toInput}
        days={range.days}
      />
      <RangeCaption days={range.days} />

      {/* Stated on the page, not only in the code: the reader of a printed
          screenshot has no access to the comments in the service. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Cash versus credits</p>
        <p className="mt-1">
          <strong>Only PromptPay / card top-ups are real money.</strong> They are the
          only baht figure the database actually holds. Everything else on this page
          is <strong>credits valued at ฿1 each</strong> — Channel Management is paid
          from wallets, so its revenue was already collected when the credits were
          bought. Adding the two together double-counts every top-up.
        </p>
        <p className="mt-1">
          Apple and Google purchases carry <strong>no price and no currency</strong>{" "}
          in this database — the stores keep both. Their baht column is imputed at
          ฿1 per credit, before store commission, and is never included in a cash
          total.
        </p>
      </div>

      {/* ── 1. Combined header ──────────────────────────────────────────── */}
      <StatTileGrid>
        <StatTile
          label="Cash received"
          value={baht(headline.cashBaht)}
          hint="payment_intents, status paid — the only true cash figure"
        />
        <StatTile
          label="Credits spent (net)"
          value={credits(headline.creditsSpentNet)}
          hint="charges less refunds, both lines; ฿1 per credit if valued"
        />
        <StatTile
          label="Paying users"
          value={headline.payingUsers}
          hint="distinct users who settled cash; excludes deleted accounts"
        />
        <StatTile
          label="ARPU (cash)"
          value={baht(headline.arpuBaht)}
          hint="cash ÷ paying users; credit-funded purchases excluded"
        />
      </StatTileGrid>

      {/* ── 2. Revenue over time ────────────────────────────────────────── */}
      <ChartFrame
        title="Revenue over time"
        description="By Bangkok day. Two different kinds of money — read the lines separately."
        footnote={
          <>
            Video generation is settled cash. Channel Management is credits spent,
            shown at ฿1 each so the two share an axis; it is not a second cash
            receipt. Exact daily figures are in the table below the chart.
          </>
        }
      >
        {hasRevenue ? (
          <TimeSeriesChart
            data={summary.revenueSeries}
            series={[
              { key: "videoGenerationBaht", label: "Video generation (cash ฿)" },
              { key: "channelManagementBaht", label: "Channel Management (credits @ ฿1)" },
            ]}
            valueSuffix=" THB"
          />
        ) : (
          <ChartEmpty message="No settled top-ups or Channel Management purchases in this range." />
        )}

        {/* The palette's contrast warning obliges relief: every charted value
            also appears as text. Collapsed because a 90-day range is 90 rows. */}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
            Show daily figures ({summary.revenueSeries.length} days)
          </summary>
          <div className="mt-3">
            <Table
              headers={["Day", "Video generation (cash)", "Channel Management (credits @ ฿1)"]}
            >
              {summary.revenueSeries.map((point) => (
                <tr key={point.date} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{point.date}</td>
                  <Money value={point.videoGenerationBaht} />
                  <Money value={point.channelManagementBaht} />
                </tr>
              ))}
            </Table>
          </div>
        </details>
      </ChartFrame>

      {/* ── 3. Video generation ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Video generation
        </h2>

        <div className="space-y-6">
          <StatTileGrid>
            <StatTile
              label="Top-up conversion"
              value={percent(vg.funnel.conversionPct)}
              hint={`${vg.funnel.paid} paid of ${vg.funnel.created} intents created`}
            />
            <StatTile
              label="Median time to pay"
              value={duration(vg.funnel.medianSecondsToPay)}
              hint="QR issued → settled; approximated from updated_at"
            />
            <StatTile
              label="Abandoned value"
              value={baht(vg.funnel.abandonedBaht)}
              hint="baht on intents that expired or failed"
            />
            <StatTile
              label="Credits spent on requests"
              value={credits(vg.creditsNet)}
              hint={`${credits(vg.creditsCharged)} charged less ${credits(
                vg.creditsRefunded
              )} refunded`}
            />
          </StatTileGrid>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Top-up funnel
            </h3>
            <Table headers={["Stage", "Intents", "Share", "Baht"]}>
              <FunnelRow
                label="Created"
                count={vg.funnel.created}
                total={vg.funnel.created}
                baht={vg.funnel.paidBaht + vg.funnel.abandonedBaht}
              />
              <FunnelRow
                label="Paid"
                count={vg.funnel.paid}
                total={vg.funnel.created}
                baht={vg.funnel.paidBaht}
              />
              <FunnelRow label="Pending" count={vg.funnel.pending} total={vg.funnel.created} />
              <FunnelRow label="Expired" count={vg.funnel.expired} total={vg.funnel.created} />
              <FunnelRow label="Failed" count={vg.funnel.failed} total={vg.funnel.created} />
            </Table>
            <p className="mt-2 text-xs text-slate-400">
              Cohort basis: intents <em>created</em> in this window, whatever their
              eventual status. A PromptPay QR is payable for 30 minutes, so an intent
              and its payment are effectively always the same Bangkok day.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              By gateway and method
            </h3>
            {vg.byGatewayMethod.length === 0 ? (
              <EmptyRow message="No payment intents in this range." />
            ) : (
              <Table headers={["Gateway", "Method", "Attempts", "Paid", "Conversion", "Cash"]}>
                {vg.byGatewayMethod.map((row) => (
                  <tr key={`${row.gateway}-${row.method}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.gateway}</td>
                    <td className="px-4 py-3 text-slate-600">{row.method}</td>
                    <Count value={row.attempts} />
                    <Count value={row.paid} />
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {percent(row.conversionPct)}
                    </td>
                    <Money value={row.paidBaht} />
                  </tr>
                ))}
              </Table>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Download unlocks
            </h3>
            <Table headers={["Measure", "Requests"]}>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">Requests created in range</td>
                <Count value={vg.downloads.requests} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">
                  Unlocked for download ({percent(vg.downloads.unlockedPct)})
                </td>
                <Count value={vg.downloads.unlocked} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">Free trial requests</td>
                <Count value={vg.downloads.trial} />
              </tr>
            </Table>
            <p className="mt-2 text-xs text-slate-400">
              <strong>Unlocks cannot be dated.</strong> `download_unlocked` is a
              boolean with no accompanying timestamp, so this counts requests{" "}
              <em>created</em> in the window that are unlocked <em>as of now</em> — not
              unlocks that happened during the window.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Mobile store purchases (imputed)
            </h3>
            {vg.mobileStore.length === 0 ? (
              <EmptyRow message="No Apple or Google purchases in this range." />
            ) : (
              <Table headers={["Platform", "Purchases", "Credits granted", "Imputed value"]}>
                {vg.mobileStore.map((row) => (
                  <tr key={row.platform} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.platform}</td>
                    <Count value={row.purchases} />
                    <Count value={row.creditsGranted} />
                    <Money value={row.impliedBaht} muted />
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="px-4 py-3 text-slate-700">Total</td>
                  <Count value={vg.mobileStoreTotals.purchases} />
                  <Count value={vg.mobileStoreTotals.creditsGranted} />
                  <Money value={vg.mobileStoreTotals.impliedBaht} muted />
                </tr>
              </Table>
            )}
            <p className="mt-2 text-xs text-slate-400">
              <strong>Imputed, not measured.</strong> `mobile_store_purchases` has no
              price and no currency column — Apple and Google keep the money and the
              receipt. The value column is credits × ฿1, before store commission. It
              is excluded from the cash tile at the top of this page. Reconcile
              against App Store Connect and Play Console for the real figure.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Legacy per-request pricing
            </h3>
            <Table headers={["Column", "Total"]}>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">clip_requests.price_baht</td>
                <Money value={vg.requestPricing.priceBaht} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">clip_requests.discount_baht</td>
                <Money value={vg.requestPricing.discountBaht} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">clip_requests.amount_paid_baht</td>
                <Money value={vg.requestPricing.amountPaidBaht} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">Requests with a non-zero price</td>
                <Count value={vg.requestPricing.pricedRequests} />
              </tr>
            </Table>
            <p className="mt-2 text-xs text-slate-400">
              These NUMERIC baht columns predate the credit model. Nothing writes
              them now — requests are charged a flat credit price at submission — so
              a row of zeros is the expected reading. They are shown rather than
              omitted because a non-zero count here is the only warning that some
              environment still books money through them.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Legacy credit purchase log
            </h3>
            {vg.purchaseLog.available ? (
              <Table headers={["Entries", "Credits added", "Baht recorded"]}>
                <tr className="hover:bg-slate-50">
                  <Count value={vg.purchaseLog.entries} />
                  <Count value={vg.purchaseLog.creditsAdded} />
                  <Money value={vg.purchaseLog.amountBaht} />
                </tr>
              </Table>
            ) : (
              <EmptyRow
                message="Unavailable — the credit_purchase_logs table does not exist in this database. It has no migration in the repository, only a repository class that reads it, so this section is skipped rather than failing the page."
              />
            )}
          </div>
        </div>
      </section>

      {/* ── 4. Channel Management ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Channel Management
        </h2>

        <div className="space-y-6">
          <StatTileGrid>
            <StatTile
              label="Credits collected"
              value={credits(cm.totals.paidCredits)}
              hint={`${cm.totals.paidCount} paid purchases; ฿${cm.totals.paidCredits.toLocaleString()} at ฿1/credit — not cash`}
            />
            <StatTile
              label="Refund rate"
              value={percent(cm.totals.refundRatePct)}
              hint={`${cm.totals.refundedCount} refunded of ${
                cm.totals.paidCount + cm.totals.refundedCount
              } settled`}
              tone={cm.totals.refundRatePct > 10 ? "urgent" : "default"}
            />
            <StatTile
              label="Active access passes"
              value={cm.passes.active}
              hint="live right now — not filtered by the date range"
            />
            <StatTile
              label="Passes expiring in 30 days"
              value={cm.passes.expiringIn30Days}
              hint="renewal window; current state, not range-bounded"
            />
          </StatTileGrid>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Purchases by product
            </h3>
            {cm.byProduct.length === 0 ? (
              <EmptyRow message="No Channel Management purchases in this range." />
            ) : (
              <Table
                headers={[
                  "Product",
                  "Paid",
                  "Credits",
                  "Refunded",
                  "Refund rate",
                  "Failed",
                  "Pending",
                ]}
              >
                {cm.byProduct.map((row) => (
                  <tr key={row.productCode} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{row.productName}</p>
                      <p className="text-xs text-slate-400">{row.productCode}</p>
                    </td>
                    <Count value={row.paidCount} />
                    <Count value={row.paidCredits} />
                    <Count value={row.refundedCount} />
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {percent(row.refundRatePct)}
                    </td>
                    <Count value={row.failedCount} />
                    <Count value={row.pendingCount} />
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Cohort basis: purchases <em>created</em> in this window. The refund
              columns mean &ldquo;of the purchases started here, how many have since
              been refunded&rdquo; — the number a pricing decision needs, not a count
              of refunds processed during the window.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Failed purchases by reason
            </h3>
            {cm.failures.length === 0 ? (
              <EmptyRow message="No failed purchases in this range." />
            ) : (
              <Table headers={["Reason", "Count"]}>
                {cm.failures.map((row) => (
                  <tr key={row.reason} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{row.reason}</td>
                    <Count value={row.count} />
                  </tr>
                ))}
              </Table>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Upload bundle burn
            </h3>
            <Table headers={["Measure", "Bundles", "Tokens"]}>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">Sold in range</td>
                <Count value={cm.bundles.bundles} />
                <Count value={cm.bundles.totalAllowance} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">
                  Spent ({percent(cm.bundles.burnPct)} of allowance)
                </td>
                <td className="px-4 py-3 text-right text-slate-400">—</td>
                <Count value={cm.bundles.burned} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">Still spendable</td>
                <td className="px-4 py-3 text-right text-slate-400">—</td>
                <Count value={cm.bundles.remaining} />
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">
                  Expired with allowance unused
                </td>
                <Count value={cm.bundles.expiredUnusedBundles} />
                <Count value={cm.bundles.expiredUnusedTokens} />
              </tr>
            </Table>
            <p className="mt-2 text-xs text-slate-400">
              The last row is the one to watch: tokens paid for and never delivered.
              It is both a refund-risk exposure and a product signal — a high number
              means the 30-day window, not the price, is what customers are failing
              to clear. Rows whose window has lapsed count here even if the status
              sweep has not run yet.
            </p>
          </div>
        </div>
      </section>

      {/* ── 5. Credit float ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Credit float
        </h2>
        <StatTileGrid>
          <StatTile
            label="Outstanding credit liability"
            value={baht(summary.creditFloat.liabilityBaht)}
            hint="credits already sold and not yet spent — owed, not earned"
          />
          <StatTile
            label="Credits outstanding"
            value={credits(summary.creditFloat.totalCredits)}
            hint="sum of credit_wallets.balance, live accounts only"
          />
          <StatTile
            label="Wallets"
            value={summary.creditFloat.wallets}
            hint="one per non-deleted user"
          />
        </StatTileGrid>
        <p className="mt-2 text-xs text-slate-400">
          Point-in-time, not filtered by the date range. This is a{" "}
          <strong>liability</strong>: the cash was collected at top-up and the service
          has not been delivered yet. It must never be added to the revenue figures
          above.
        </p>
      </section>

      {/* ── Ledger detail ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Credit ledger by type
        </h2>
        {summary.creditTypes.length === 0 ? (
          <EmptyRow message="No credit transactions in this range." />
        ) : (
          <Table headers={["Type", "Transactions", "Net credits"]}>
            {summary.creditTypes.map((row) => (
              <tr key={row.type} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{row.type}</td>
                <Count value={row.count} />
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {row.credits > 0 ? "+" : ""}
                  {row.credits.toLocaleString()}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-2 text-xs text-slate-400">
          Signed as stored: negative is a debit. `signup_bonus` and `admin_credit` are
          marketing cost, not revenue, and are excluded from the credits-spent tile.
        </p>
      </section>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

/** `฿1,234.00`. Always two decimals — baht columns are NUMERIC(10,2). */
function baht(value: number): string {
  return `฿${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Credits are whole units; showing decimals implies a precision we lack. */
function credits(value: number): string {
  return `${Math.round(value).toLocaleString()} cr`;
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Seconds → a human span, or an em dash when nothing settled.
 *
 * `null` is meaningfully different from zero here: no paid intents at all, so
 * the median is undefined rather than instant.
 */
function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            {headers.map((header, i) => (
              <th key={header} className={i === 0 ? "px-4 py-3" : "px-4 py-3 text-right"}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/** Right-aligned integer cell. `tabular-nums` keeps the column edges straight. */
function Count({ value }: { value: number }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
      {value.toLocaleString()}
    </td>
  );
}

/** Right-aligned baht cell. `muted` marks an imputed figure, not a measured one. */
function Money({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <td
      className={`px-4 py-3 text-right tabular-nums ${
        muted ? "text-slate-500 italic" : "text-slate-900"
      }`}
    >
      {baht(value)}
    </td>
  );
}

function FunnelRow({
  label,
  count,
  total,
  baht: amount,
}: {
  label: string;
  count: number;
  total: number;
  baht?: number;
}) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 font-medium text-slate-900">{label}</td>
      <Count value={count} />
      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
        {total > 0 ? percent((count / total) * 100) : "—"}
      </td>
      {amount === undefined ? (
        <td className="px-4 py-3 text-right text-slate-400">—</td>
      ) : (
        <Money value={amount} />
      )}
    </tr>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-500">
      {message}
    </div>
  );
}
