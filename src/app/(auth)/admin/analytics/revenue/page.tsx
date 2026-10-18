import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange, toBangkokDateInput } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { TimeSeriesChart } from "@/features/admin/charts/TimeSeriesChart";
import { GroupedBarChart } from "@/features/admin/charts/GroupedBarChart";
import { attempt } from "@/features/admin/attempt";
import { AdminErrorPanel } from "@/features/admin/components/AdminErrorPanel";
import { ROUTES } from "@/config/routes";
import {
  CHANNEL_LABELS,
  adminRevenueService,
  type RevenueChannel,
} from "@/services/admin/AdminRevenueService";

export const metadata: Metadata = { title: "Revenue — Admin" };

/**
 * The money users pay: Stripe (PromptPay / card), App Store and Google Play.
 *
 * Every channel sells credits; the page reports what was paid, by whom, through
 * which channel, and what the credits were then spent on. Ledger detail and
 * Channel Management purchases stay on the Payments page.
 */
export default async function AdminRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(Role.Admin);
  const range = parseDateRange(await searchParams);
  const reportAttempt = await attempt(
    () => adminRevenueService.getReport({ from: range.from, to: range.to }),
    "Revenue"
  );

  const header = (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Revenue</h1>
      <p className="mt-1 text-sm text-slate-500">
        What users pay through Stripe (PromptPay and card), the App Store and Google Play — by
        channel, by day, by product and by payer. Credit-ledger detail is on{" "}
        <a className="underline" href={ROUTES.ADMIN_PAYMENTS}>
          Payments
        </a>
        .
      </p>
    </div>
  );

  if (!reportAttempt.ok) {
    return (
      <div className="space-y-8">
        {header}
        <AdminErrorPanel title="Revenue could not be loaded" error={reportAttempt.error} />
      </div>
    );
  }

  const report = reportAttempt.data;
  const { totals, signupConversion: conv, dataNotes } = report;
  const commissionPct = Math.round(dataNotes.commissionRate * 100);
  const hasDaily = report.daily.some((d) => d.total > 0);
  const storeGross = report.channels
    .filter((c) => c.channel === "app_store" || c.channel === "google_play")
    .reduce((sum, c) => sum + c.grossThb, 0);
  const otherCurrencies = report.channels.flatMap((c) =>
    c.otherCurrencies.map((o) => ({ ...o, label: c.label }))
  );

  return (
    <div className="space-y-8">
      {header}

      <DateRangeBar fromInput={range.fromInput} toInput={range.toInput} days={range.days} />
      <RangeCaption days={range.days} />

      {(dataNotes.estimatedStorePayments > 0 || otherCurrencies.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Read the store figures with care</p>
          {dataNotes.estimatedStorePayments > 0 && (
            <p className="mt-1">
              {dataNotes.estimatedStorePayments.toLocaleString()} App Store / Google Play
              purchase{dataNotes.estimatedStorePayments === 1 ? " has" : "s have"} no recorded
              price (made before prices were stored) and {dataNotes.estimatedStorePayments === 1 ? "is" : "are"}{" "}
              valued at the catalogue&rsquo;s planned price. Purchases from now on store the
              price the store charged.
            </p>
          )}
          {otherCurrencies.length > 0 && (
            <p className="mt-1">
              Some purchases were made in another currency and are not added to the baht totals:{" "}
              {otherCurrencies
                .map((o) => `${o.label} ${o.amount.toLocaleString()} ${o.currency} (${o.payments})`)
                .join(", ")}
              .
            </p>
          )}
        </div>
      )}

      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <StatTileGrid>
        <StatTile
          label="Paid by users"
          value={baht(totals.grossThb)}
          hint={`${totals.payments.toLocaleString()} payments · about ${baht(totals.netThb)} after store commission`}
          tone="good"
        />
        <StatTile
          label="Paying users"
          value={totals.payingUsers}
          hint={`${totals.newPayers.toLocaleString()} paid for the first time · ${totals.repeatPayers.toLocaleString()} paid more than once`}
        />
        <StatTile
          label="Average per paying user"
          value={totals.arppuThb === null ? "—" : baht(totals.arppuThb)}
          hint="baht paid in range ÷ paying users"
        />
        <StatTile
          label="New users who paid"
          value={conv.newUsers > 0 ? percent((conv.paid / conv.newUsers) * 100) : "—"}
          hint={`${conv.paid.toLocaleString()} of ${conv.newUsers.toLocaleString()} signed up in range${
            conv.medianDaysToFirstPayment === null
              ? ""
              : ` · median ${conv.medianDaysToFirstPayment.toFixed(1)} days to first payment`
          }`}
        />
      </StatTileGrid>

      {/* ── By channel ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-400">
          By channel
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Gross is what the user paid. For the stores, net is gross minus the {commissionPct}%
          small-business commission — an estimate before VAT and tax; App Store Connect and Play
          Console payouts are the final figure. Stripe&rsquo;s fee is not recorded, so Stripe is
          shown gross. Store sandbox/test purchases are excluded
          {dataNotes.storeTestPurchases > 0 && ` (${dataNotes.storeTestPurchases.toLocaleString()} in this range)`}.
        </p>
        <Table
          headers={["Channel", "Payments", "Paying users", "Gross", "Net (est.)", "Average", "Credits sold", "Share"]}
        >
          {report.channels.map((c) => (
            <tr key={c.channel} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">
                {c.label}
                {c.estimatedPayments > 0 && (
                  <span className="ml-2 text-xs font-normal text-amber-700">
                    {c.estimatedPayments} estimated
                  </span>
                )}
              </td>
              <Count value={c.payments} />
              <Count value={c.payingUsers} />
              <Money value={c.grossThb} strong />
              <Money value={c.netThb} />
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {c.avgThb === null ? "—" : baht(c.avgThb)}
              </td>
              <Count value={c.credits} />
              <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                {totals.grossThb > 0 ? percent((c.grossThb / totals.grossThb) * 100) : "—"}
              </td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-4 py-3 text-slate-900">Total</td>
            <Count value={totals.payments} />
            <Count value={totals.payingUsers} />
            <Money value={totals.grossThb} strong />
            <Money value={totals.netThb} />
            <td className="px-4 py-3 text-right tabular-nums text-slate-700">
              {totals.payments > 0 ? baht(totals.grossThb / Math.max(1, totals.payments)) : "—"}
            </td>
            <Count value={report.channels.reduce((s, c) => s + c.credits, 0)} />
            <td className="px-4 py-3 text-right tabular-nums text-slate-500">
              {totals.grossThb > 0 ? `stores ${percent((storeGross / totals.grossThb) * 100)}` : "—"}
            </td>
          </tr>
        </Table>
      </section>

      {/* ── Per day ──────────────────────────────────────────────────────── */}
      <ChartFrame
        title="Baht paid per day, by channel"
        description="Gross baht per Bangkok day. Store purchases are dated when the store says they were bought."
      >
        {hasDaily ? (
          <TimeSeriesChart
            data={report.daily.map((d) => ({
              date: d.date,
              stripe_promptpay: d.stripe_promptpay,
              stripe_card: d.stripe_card,
              app_store: d.app_store,
              google_play: d.google_play,
            }))}
            series={(Object.keys(CHANNEL_LABELS) as RevenueChannel[]).map((key) => ({
              key,
              label: CHANNEL_LABELS[key],
            }))}
            valueSuffix=" ฿"
          />
        ) : (
          <ChartEmpty message="No payments in this range." />
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
            Show daily figures ({report.daily.length} days)
          </summary>
          <div className="mt-3">
            <Table headers={["Day", "PromptPay", "Card", "App Store", "Google Play", "Total"]}>
              {report.daily.map((d) => (
                <tr key={d.date} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{d.date}</td>
                  <Money value={d.stripe_promptpay} />
                  <Money value={d.stripe_card} />
                  <Money value={d.app_store} />
                  <Money value={d.google_play} />
                  <Money value={d.total} strong />
                </tr>
              ))}
            </Table>
          </div>
        </details>
      </ChartFrame>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Stripe checkout ─────────────────────────────────────────────── */}
        <ChartFrame
          title="Stripe checkouts"
          description="Every PromptPay QR or card checkout started in range, and what happened to it."
          footnote="A QR that expired is usually someone who saw the price and did not pay. Time to pay runs from opening the checkout to Stripe confirming it."
        >
          {report.stripeFunnel.length === 0 ? (
            <ChartEmpty message="No Stripe checkouts started in this range." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2">Method</th>
                  <th className="py-2 text-right">Started</th>
                  <th className="py-2 text-right">Paid</th>
                  <th className="py-2 text-right">Expired</th>
                  <th className="py-2 text-right">Failed</th>
                  <th className="py-2 text-right">Open</th>
                  <th className="py-2 text-right">Time to pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.stripeFunnel.map((row) => (
                  <tr key={row.method}>
                    <td className="py-2 font-medium text-slate-900">{row.label}</td>
                    <td className="py-2 text-right tabular-nums">{row.started}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-700">
                      {row.paid}
                      <span className="ml-1 text-xs text-slate-400">
                        {row.paidPct === null ? "" : percent(row.paidPct)}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{row.expired}</td>
                    <td className="py-2 text-right tabular-nums text-red-700">{row.failed}</td>
                    <td className="py-2 text-right tabular-nums">{row.pending}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500">
                      {row.medianMinutesToPay === null ? "—" : `${row.medianMinutesToPay.toFixed(1)} min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ChartFrame>

        {/* ── Credits spent on ────────────────────────────────────────────── */}
        <ChartFrame
          title="What the credits were spent on"
          description="Credits users spent in range, by what they bought. All channels sell credits; this is where they go."
        >
          {report.creditUse.length === 0 ? (
            <ChartEmpty message="No credits spent in this range." />
          ) : (
            <GroupedBarChart
              data={report.creditUse.map((row) => ({ category: row.label, credits: row.credits }))}
              series={[{ key: "credits", label: "Credits spent" }]}
            />
          )}
        </ChartFrame>
      </div>

      {/* ── Products ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          What people buy
        </h2>
        {report.products.length === 0 ? (
          <EmptyRow message="No payments in this range." />
        ) : (
          <Table headers={["Channel", "Product", "Payments", "Gross", "Credits"]} textColumns={[1]}>
            {report.products.map((p) => (
              <tr key={`${p.channel}-${p.product}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">{CHANNEL_LABELS[p.channel]}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{p.product}</td>
                <Count value={p.payments} />
                <Money value={p.grossThb} strong />
                <Count value={p.credits} />
              </tr>
            ))}
          </Table>
        )}
      </section>

      {/* ── Payers ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Top paying users
        </h2>
        {report.topPayers.length === 0 ? (
          <EmptyRow message="Nobody paid in this range." />
        ) : (
          <Table
            headers={["User", "Paid", "Payments", "Channels", "Last payment", "First ever"]}
            textColumns={[3, 4, 5]}
          >
            {report.topPayers.map((p) => (
              <tr key={p.email + p.lastAt.toISOString()} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-900">{p.email}</td>
                <Money value={p.grossThb} strong />
                <Count value={p.payments} />
                <td className="px-4 py-3 text-xs text-slate-600">{p.channels.join(", ")}</td>
                <td className="px-4 py-3 text-slate-600">{toBangkokDateInput(p.lastAt)}</td>
                <td className="px-4 py-3 text-slate-500">
                  {p.firstEver ? toBangkokDateInput(p.firstEver) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section>
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
            Latest payments ({report.recent.length})
          </summary>
          <div className="border-t border-slate-100 p-3">
            <Table headers={["When", "User", "Channel", "Product", "Amount", "Credits"]} textColumns={[1, 2, 3]}>
              {report.recent.map((p, i) => (
                <tr key={`${p.at.toISOString()}-${i}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">
                    {p.at.toLocaleString("en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{p.email}</td>
                  <td className="px-4 py-3 text-slate-700">{CHANNEL_LABELS[p.channel]}</td>
                  <td className="px-4 py-3 text-slate-600">{p.product}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {p.currency === "THB" ? baht(p.amount) : `${p.amount.toLocaleString()} ${p.currency}`}
                    {p.estimated && <span className="ml-1 text-xs text-amber-700">est.</span>}
                  </td>
                  <Count value={p.credits} />
                </tr>
              ))}
            </Table>
          </div>
        </details>
      </section>

      <p className="text-xs text-slate-400">
        Not yet tracked: refunds made in the App Store or Google Play (the stores do not tell
        RClipper yet), and Stripe&rsquo;s processing fee. Store sandbox and test purchases never
        count as revenue.
      </p>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

function baht(value: number): string {
  return `฿${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function Table({
  headers,
  textColumns = [],
  children,
}: {
  headers: string[];
  textColumns?: number[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            {headers.map((header, i) => (
              <th
                key={header}
                className={i === 0 || textColumns.includes(i) ? "px-4 py-3" : "px-4 py-3 text-right"}
              >
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

function Count({ value }: { value: number }) {
  return <td className="px-4 py-3 text-right tabular-nums text-slate-700">{value.toLocaleString()}</td>;
}

function Money({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>
      {value === 0 ? "—" : baht(value)}
    </td>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-500">
      {message}
    </div>
  );
}
