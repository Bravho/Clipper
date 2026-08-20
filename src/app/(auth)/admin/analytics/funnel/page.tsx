import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange, toBangkokDateInput } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { FunnelBars } from "@/features/admin/charts/FunnelBars";
import { TimeSeriesChart } from "@/features/admin/charts/TimeSeriesChart";
import { adminFunnelService } from "@/services/admin/AdminFunnelService";
import type { FunnelStageKey } from "@/services/admin/AdminFunnelService";
import { attempt } from "@/features/admin/attempt";
import { AdminErrorPanel } from "@/features/admin/components/AdminErrorPanel";

export const metadata: Metadata = { title: "Conversion Funnel — Admin" };

/**
 * Signup → publish, in nine stages.
 *
 * The page has one job beyond drawing bars: making the shape of the data
 * honest. Three things about this funnel are easy to misread and are therefore
 * stated on the page rather than only in the service:
 *
 *   1. It is a COHORT funnel. Stage 1 is who signed up in the window; the later
 *      stages count those same people at any later date. Recent windows always
 *      understate the bottom of the funnel.
 *   2. Stages 1–2 only have data from the day login instrumentation shipped.
 *      That date is detected from the table, never hardcoded.
 *   3. A funnel that widens is a bug. If a later stage exceeds an earlier one
 *      the page says so instead of drawing it.
 */
export default async function AdminFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(Role.Admin);

  const params = await searchParams;
  const range = parseDateRange(params);

  // Each load is caught separately. A funnel query that fails against an
  // unexpected data shape should cost its own section, not the whole page —
  // and in production a thrown error is replaced by an opaque digest, so
  // catching here is the only way the admin ever sees what actually broke.
  const [reportAttempt, trendAttempt, instrumentationAttempt] = await Promise.all([
    attempt(() => adminFunnelService.getFunnelReport(range.from, range.to), "Funnel report"),
    attempt(() => adminFunnelService.getSignupLoginTrend(range.from, range.to), "Signup/login trend"),
    attempt(() => adminFunnelService.getLoginInstrumentation(), "Login instrumentation"),
  ]);

  if (!reportAttempt.ok) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Conversion funnel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Signup through to publishing, counted as distinct users.
          </p>
        </div>
        <AdminErrorPanel title="The funnel could not be built" error={reportAttempt.error} />
      </div>
    );
  }

  const report = reportAttempt.data;
  const trend = trendAttempt.ok ? trendAttempt.data : [];
  const instrumentation = instrumentationAttempt.ok
    ? instrumentationAttempt.data
    : { available: false, firstRealLoginAt: null, realLoginRows: 0, backfillRows: 0 };

  const { stages } = report;
  const hasTrend = trend.some((point) => point.signups > 0 || point.logins > 0);

  const bugWarnings = report.warnings.filter((w) => w.severity === "bug");
  const knownGapWarnings = report.warnings.filter((w) => w.severity === "known-gap");

  // Login data only exists from the first real (non-backfill) sign-in onwards.
  // Cohorts that predate it cannot show stage 2 at all — worth saying before an
  // admin reads a structural zero as a retention collapse.
  const loginStart = instrumentation.firstRealLoginAt;
  const loginStartInput = loginStart ? toBangkokDateInput(loginStart) : null;
  const rangeStartsBeforeLogins = loginStart ? range.from < loginStart : true;

  // The stage-5 cross-check: the download flag and the credit ledger are written
  // by different code paths, so a gap between them is a reconciliation problem.
  const paidStage = stages[4];
  const chargeGap = report.chargedUsers - (paidStage?.users ?? 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Conversion Funnel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signup through to publishing on a connected channel, counted as distinct
          users.
        </p>
      </div>

      <DateRangeBar
        fromInput={range.fromInput}
        toInput={range.toInput}
        days={range.days}
      />
      <RangeCaption days={range.days} />

      {/* A widening funnel is loud on purpose: the alternative is a bar chart
          that reads as a business discovery. The two pairs that can widen
          honestly are demoted to a note — a banner that is always red is
          furniture, and the next real join bug would be scrolled past. */}
      {bugWarnings.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">This funnel widens — that is a data bug</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {bugWarnings.map((warning) => (
              <li key={`${warning.fromStage}-${warning.toStage}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {knownGapWarnings.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold">Two stages are out of order, for known reasons</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {knownGapWarnings.map((warning) => (
              <li key={`${warning.fromStage}-${warning.toStage}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The table itself is absent — a deployment problem, not a data finding.
          Name the migration and the likely cause, because the symptom (a zero
          login stage) is indistinguishable from a genuine one. */}
      {!instrumentation.available && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">
            Login tracking table is missing from this database
          </p>
          <p className="mt-1">
            <code>user_login_events</code> does not exist, so stage 2 reads zero
            for every cohort no matter how many people actually signed in. Apply{" "}
            <code>src/db/migrations/028_admin_analytics.sql</code> to the database
            this app connects to — if you have already run it, check{" "}
            <code>PGDATABASE</code>, since it may have been applied to a different
            one. Every other stage on this page is unaffected.
          </p>
        </div>
      )}

      {/* Stated on the page, not only in the code: the reader of a printed
          screenshot has no access to the comments in the service. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">What these nine numbers are counting</p>
        <p className="mt-1">
          <strong>Cohort basis.</strong> Stage 1 is the users who signed up inside
          this window. Stages 2–9 count how many of <em>those</em> users have since
          reached each stage — at any later date, not only inside the window. A user
          who signed up yesterday has not had time to pay, so recent windows always
          understate the bottom of the funnel.
        </p>
        <p className="mt-1">
          <strong>Stages 1–2 are not retroactive.</strong> Login tracking did not
          exist before <code>user_login_events</code> shipped:{" "}
          {loginStartInput ? (
            <>
              the earliest real sign-in on record is <strong>{loginStartInput}</strong>
              , so any cohort before that date shows zero logins because nothing was
              recorded, not because nobody signed in.
            </>
          ) : (
            <>
              no real sign-in has been recorded yet, so stage 2 is structurally zero
              across the whole table.
            </>
          )}{" "}
          {instrumentation.backfillRows > 0 && (
            <>
              The {instrumentation.backfillRows.toLocaleString()} synthetic{" "}
              <code>provider = &lsquo;backfill&rsquo;</code> rows derived from{" "}
              <code>users.created_at</code> are excluded everywhere on this page —
              counting them would report a 100% login rate for every
              pre-instrumentation cohort.
            </>
          )}{" "}
          Stages 3–9 read tables that predate the analytics work and are fully
          retroactive.
        </p>
      </div>

      {/* ── 1. Headline ─────────────────────────────────────────────────── */}
      <StatTileGrid>
        <StatTile
          label="Users signed up"
          value={report.totalUsers}
          hint="live accounts created in range; deleted accounts excluded"
        />
        <StatTile
          label="Signup → paid generation"
          value={percent(report.overallConversionPct)}
          hint={`stage 1 → stage 5 · ${(paidStage?.users ?? 0).toLocaleString()} of ${report.totalUsers.toLocaleString()}`}
        />
        <StatTile
          label="Biggest single drop-off"
          value={
            report.biggestDrop
              ? `−${report.biggestDrop.dropped.toLocaleString()}`
              : "—"
          }
          hint={
            report.biggestDrop
              ? `${report.biggestDrop.fromLabel} → ${report.biggestDrop.toLabel} (${percent(
                  report.biggestDrop.pct
                )} lost)`
              : "no stage-to-stage loss in this cohort"
          }
          tone={report.biggestDrop ? "urgent" : "default"}
        />
        <StatTile
          label="Charged in the credit ledger"
          value={report.chargedUsers}
          hint={
            chargeGap === 0
              ? "agrees with stage 5"
              : `${chargeGap > 0 ? "+" : ""}${chargeGap.toLocaleString()} vs stage 5 — see the note below`
          }
          tone={chargeGap === 0 ? "default" : "urgent"}
        />
      </StatTileGrid>

      {/* ── 2. The funnel ───────────────────────────────────────────────── */}
      <ChartFrame
        title="Nine stages, distinct users"
        description="Bar width is scaled to stage 1. The smaller figure beside each count is events, not people."
        footnote={
          <>
            Stage 5 is counted from <code>clip_requests.download_unlocked</code> on a
            non-trial request.{" "}
            {chargeGap === 0 ? (
              <>
                The independent count from{" "}
                <code>credit_transactions.type = &lsquo;request_charge&rsquo;</code>{" "}
                agrees exactly.
              </>
            ) : (
              <>
                The independent count from{" "}
                <code>credit_transactions.type = &lsquo;request_charge&rsquo;</code>{" "}
                gives {report.chargedUsers.toLocaleString()} users — a gap of{" "}
                {Math.abs(chargeGap).toLocaleString()}. Charges without an unlock are
                usually refunded or failed generations; unlocks without a charge are
                usually admin grants.
              </>
            )}
          </>
        }
      >
        {report.totalUsers === 0 ? (
          <ChartEmpty message="Nobody signed up in this range, so there is no cohort to follow. Widen the window." />
        ) : (
          <FunnelBars
            stages={stages.map((stage) => ({
              label: stage.label,
              users: stage.users,
              events: stage.events,
              hint: stage.hint,
            }))}
          />
        )}
      </ChartFrame>

      {/* ── 3. Signup and login trend ───────────────────────────────────── */}
      <ChartFrame
        title="Signups and logins per day"
        description="Signups are new accounts; logins are distinct users signing in that Bangkok day."
        footnote={
          <>
            Logins exclude the synthetic backfill provider.{" "}
            {rangeStartsBeforeLogins &&
              "Part of this window predates login instrumentation, so the login line starts flat at zero. "}
            Exact daily figures are in the table below the chart.
          </>
        }
      >
        {hasTrend ? (
          <TimeSeriesChart
            data={trend.map((point) => ({
              date: point.date,
              signups: point.signups,
              logins: point.logins,
            }))}
            series={[
              { key: "signups", label: "Signups" },
              { key: "logins", label: "Distinct users logged in" },
            ]}
          />
        ) : (
          <ChartEmpty message="No signups and no recorded logins in this range." />
        )}

        {/* The palette's contrast warning obliges relief: every charted value
            also appears as text. Collapsed because a 90-day range is 90 rows. */}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
            Show daily figures ({trend.length} days)
          </summary>
          <div className="mt-3">
            <Table headers={["Day", "Signups", "Distinct users logged in"]}>
              {trend.map((point) => (
                <tr key={point.date} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{point.date}</td>
                  <Count value={point.signups} />
                  <Count value={point.logins} />
                </tr>
              ))}
            </Table>
          </div>
        </details>
      </ChartFrame>

      {/* ── 4. Cohorts ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          By signup week
        </h2>
        {report.cohorts.length === 0 ? (
          <EmptyRow message="No signups in this range, so there are no cohorts to compare." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Week of</th>
                  {stages.map((stage, i) => (
                    <th key={stage.key} className="px-4 py-3 text-right" title={stage.label}>
                      {i + 1}. {SHORT_LABELS[stage.key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.cohorts.map((cohort) => (
                  <tr key={cohort.week} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium tabular-nums text-slate-900">
                      {cohort.week}
                    </td>
                    {cohort.users.map((count, i) => (
                      <td
                        key={stages[i].key}
                        className="px-4 py-3 text-right tabular-nums text-slate-700"
                      >
                        {count.toLocaleString()}
                        {i > 0 && (
                          <span className="ml-1 text-xs text-slate-400">
                            {cohort.users[0] > 0
                              ? `${((count / cohort.users[0]) * 100).toFixed(0)}%`
                              : "—"}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          <strong>This table, not the funnel above, is where onboarding
          improvements show up.</strong> The aggregate funnel mixes every cohort in
          the window together, so a month of better onboarding is averaged away
          against the month before it. Read down a column instead: the percentage is
          that stage as a share of the same week&rsquo;s signups. Weeks are Bangkok
          weeks starting Monday, and the most recent rows are always low — those
          users have had the least time to convert.
        </p>
      </section>

      {/* ── 5. How each stage is counted ────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Stage definitions
        </h2>
        <Table headers={["Stage", "Users", "Events", "Counted from"]} textColumns={[3]}>
          {stages.map((stage, i) => (
            <tr key={stage.key} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">
                {i + 1}. {stage.label}
              </td>
              <Count value={stage.users} />
              <Count value={stage.events} />
              <td className="px-4 py-3 text-slate-500">{stage.hint}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-400">
          Stages 6 and 7 are alternative <em>entry paths</em> into Channel
          Management — transferring a generated video and uploading your own are
          independent actions — so the step between them is not a conversion in the
          way the others are.
        </p>
      </section>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Nine stage names will not fit across one table header, so the cohort table
 * gets a shortened form, keyed by the stage's stable key rather than its label
 * (a reworded label must not silently fall back to the long form).
 */
const SHORT_LABELS: Record<FunnelStageKey, string> = {
  signed_up: "Signed up",
  logged_in: "Logged in",
  started_generation: "Started",
  reached_final_step: "Finished",
  paid_for_generation: "Paid",
  transferred_to_management: "Transferred",
  uploaded_to_management: "Uploaded",
  paid_for_management: "Paid CM",
  published: "Published",
};

function Table({
  headers,
  textColumns = [],
  children,
}: {
  headers: string[];
  /** Indexes that hold prose rather than numbers, so they stay left-aligned. */
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
                className={
                  i === 0 || textColumns.includes(i)
                    ? "px-4 py-3"
                    : "px-4 py-3 text-right"
                }
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

/** Right-aligned integer cell. `tabular-nums` keeps the column edges straight. */
function Count({ value }: { value: number }) {
  return (
    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
      {value.toLocaleString()}
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
