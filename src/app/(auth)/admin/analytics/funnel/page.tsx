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
import { attempt } from "@/features/admin/attempt";
import { AdminErrorPanel } from "@/features/admin/components/AdminErrorPanel";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = { title: "Conversion Funnel — Admin" };

/**
 * New users through the studio, step by step — and where they stop.
 *
 * Every video is made in the studio now and there is no approval by anyone but
 * the requester, so the funnel follows the studio's own milestones. Each user
 * is placed at the furthest milestone there is evidence for (see
 * AdminFunnelService), which makes the bars monotonic and retroactive; the
 * "recorded" figure under each bar is the direct evidence alone.
 */
export default async function AdminFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(Role.Admin);

  const params = await searchParams;
  const range = parseDateRange(params);

  const [reportAttempt, trendAttempt, instrumentationAttempt] = await Promise.all([
    attempt(() => adminFunnelService.getFunnelReport(range.from, range.to), "Funnel report"),
    attempt(() => adminFunnelService.getSignupLoginTrend(range.from, range.to), "Daily trend"),
    attempt(() => adminFunnelService.getLoginInstrumentation(), "Tracking dates"),
  ]);

  const header = (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Conversion Funnel</h1>
      <p className="mt-1 text-sm text-slate-500">
        New users through the studio, from signing up to publishing their video — and the
        step where each one stopped.
      </p>
    </div>
  );

  if (!reportAttempt.ok) {
    return (
      <div className="space-y-8">
        {header}
        <AdminErrorPanel title="The funnel could not be built" error={reportAttempt.error} />
      </div>
    );
  }

  const report = reportAttempt.data;
  const trend = trendAttempt.ok ? trendAttempt.data : [];
  const tracking = instrumentationAttempt.ok
    ? instrumentationAttempt.data
    : {
        available: false,
        firstRealLoginAt: null,
        realLoginRows: 0,
        backfillRows: 0,
        firstStudioEventAt: null,
      };
  const { stages } = report;
  const total = report.totalUsers;
  const hasTrend = trend.some((p) => p.signups > 0 || p.logins > 0 || p.studioUsers > 0);
  const studioStart = tracking.firstStudioEventAt
    ? toBangkokDateInput(tracking.firstStudioEventAt)
    : null;
  const loginStart = tracking.firstRealLoginAt
    ? toBangkokDateInput(tracking.firstRealLoginAt)
    : null;
  const stoppedBeforeEnd = report.stopPoints
    .filter((point) => point.nextLabel !== null && point.users > 0)
    .sort((a, b) => b.users - a.users);
  const worstStop = stoppedBeforeEnd[0] ?? null;

  return (
    <div className="space-y-8">
      {header}

      <DateRangeBar fromInput={range.fromInput} toInput={range.toInput} days={range.days} />
      <RangeCaption days={range.days} />

      {!report.studioTracking && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Studio step tracking is not switched on in this database</p>
          <p className="mt-1">
            <code>studio_events</code> does not exist, so &ldquo;Opened the studio&rdquo; and
            every click on{" "}
            <a className="underline" href={ROUTES.ADMIN_ANALYTICS_STUDIO}>
              Studio Activity
            </a>{" "}
            read zero. Apply <code>src/db/migrations/041_studio_events.sql</code>. The pipeline
            stages below are unaffected.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">How to read this page</p>
        <p className="mt-1">
          <strong>Cohort.</strong> Stage 1 is the users (admins excluded) who signed up in this
          window; every other stage counts those same users at any later date. Recent windows
          are always low at the bottom — those users have had the least time.
        </p>
        <p className="mt-1">
          <strong>Furthest step.</strong> The studio&rsquo;s steps happen in a fixed order, so
          each user is counted up to the furthest step they reached: a user with a finished
          video is counted as having signed in and opened the studio even if that happened
          before tracking existed. Under each bar, <em>recorded</em> is the direct evidence
          only. Login tracking starts {loginStart ? <strong>{loginStart}</strong> : "— none yet"};
          studio step tracking starts{" "}
          {studioStart ? <strong>{studioStart}</strong> : "— none yet (migration 041 is new)"}.
          Everything from &ldquo;Saved a brief&rdquo; on comes from the request and pipeline
          tables and is fully retroactive.
        </p>
      </div>

      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <StatTileGrid>
        <StatTile label="New users" value={total} hint="signed up in range, admins excluded" />
        <StatTile
          label="Made a video"
          value={percent(report.madeVideoPct)}
          hint={`reached "Main video made" · ${countAt(stages, "main_video_made")} of ${total.toLocaleString()}`}
        />
        <StatTile
          label="Most common stopping point"
          value={worstStop ? worstStop.users.toLocaleString() : "—"}
          hint={
            worstStop
              ? `stopped after "${worstStop.reachedLabel}" (${percent(worstStop.pct)} of new users)`
              : "nobody stopped before the end"
          }
          tone={worstStop ? "urgent" : "default"}
        />
        <StatTile
          label="Bought a package"
          value={report.side.boughtPackage}
          hint={`${report.side.boughtAndMadeVideo.toLocaleString()} of them also made a video · ${report.side.quotaBlocked.toLocaleString()} hit the free limit`}
        />
      </StatTileGrid>

      {/* ── The funnel ───────────────────────────────────────────────────── */}
      <ChartFrame
        title={`${stages.length} studio steps, distinct users`}
        description="Bar width is scaled to stage 1. The percentage on the right is the share kept from the step before."
        footnote={
          <>
            Package purchases and uploading your own video into Channel Management are not
            steps in this journey (you can do either without making a video), so they are
            counted beside it: {report.side.boughtPackage.toLocaleString()} bought a package,{" "}
            {report.side.uploadedOwn.toLocaleString()} uploaded their own video.
          </>
        }
      >
        {total === 0 ? (
          <ChartEmpty message="Nobody signed up in this range. Widen the window." />
        ) : (
          <FunnelBars
            stages={stages.map((stage) => ({
              label: `${stage.label}  ·  ${stage.where}`,
              users: stage.users,
              hint: `recorded directly: ${stage.recorded.toLocaleString()} — ${stage.hint}`,
            }))}
          />
        )}
      </ChartFrame>

      {/* ── Where they stop ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Where new users stop
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Each new user once, at the furthest step they reached. &ldquo;Still active&rdquo; means
          they did something in the last 3 days, so they may yet carry on; the rest have most
          likely left at that step. Problems are what we can see in the data: a failed job, a
          phone render error, or the free-video limit.
        </p>
        {total === 0 ? (
          <EmptyRow message="No new users in this range." />
        ) : (
          <Table
            headers={[
              "Furthest step reached",
              "Users",
              "Share",
              "Still active",
              "Median idle",
              "Failed job",
              "Free limit hit",
              "What we see",
            ]}
            textColumns={[7]}
          >
            {report.stopPoints
              .filter((point) => point.users > 0)
              .map((point) => (
                <tr
                  key={point.stageIndex}
                  className={point.nextLabel === null ? "bg-emerald-50/60" : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-3 text-slate-900">
                    <span className="font-medium">
                      {point.stageIndex + 1}. {point.reachedLabel}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {point.nextLabel ? `did not reach: ${point.nextLabel}` : "finished the journey"}
                    </span>
                  </td>
                  <Count value={point.users} />
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {percent(point.pct)}
                  </td>
                  <Count value={point.activeRecently} />
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {point.medianIdleDays === null ? "—" : `${point.medianIdleDays.toFixed(1)} d`}
                  </td>
                  <Count value={point.failed} />
                  <Count value={point.quotaBlocked} />
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {point.topProblems.length === 0
                      ? "—"
                      : point.topProblems.map((problem) => (
                          <span key={problem.label} className="block">
                            {problem.label} ({problem.users})
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
          </Table>
        )}
      </section>

      {/* ── People to follow up ──────────────────────────────────────────── */}
      {report.stuckUsers.length > 0 && (
        <section>
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
              New users who have not finished ({report.stuckUsers.length} most recently active)
            </summary>
            <div className="border-t border-slate-100 p-3">
              <Table
                headers={["User", "Signed up", "Stopped at", "Next step", "Last active", "What we see"]}
                textColumns={[1, 2, 3, 4, 5]}
              >
                {report.stuckUsers.map((user) => (
                  <tr key={`${user.email}-${user.signedUpAt.toISOString()}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900">{user.email}</td>
                    <td className="px-4 py-3 text-slate-600">{toBangkokDateInput(user.signedUpAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{user.stageLabel}</td>
                    <td className="px-4 py-3 text-slate-500">{user.nextLabel ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {user.lastActiveAt ? toBangkokDateInput(user.lastActiveAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{user.problem ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </details>
        </section>
      )}

      {/* ── Daily new users and activity ─────────────────────────────────── */}
      <ChartFrame
        title="New users and activity per day"
        description="Signups are new accounts; signed in and active in the studio are distinct users that Bangkok day."
        footnote="Active in the studio = any studio event, or a request created or changed that day. Exact figures are in the table below."
      >
        {hasTrend ? (
          <TimeSeriesChart
            data={trend.map((point) => ({
              date: point.date,
              signups: point.signups,
              logins: point.logins,
              studio: point.studioUsers,
            }))}
            series={[
              { key: "signups", label: "New users" },
              { key: "logins", label: "Signed in" },
              { key: "studio", label: "Active in the studio" },
            ]}
          />
        ) : (
          <ChartEmpty message="No signups, sign-ins or studio activity in this range." />
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
            Show daily figures ({trend.length} days)
          </summary>
          <div className="mt-3">
            <Table headers={["Day", "New users", "Signed in", "Active in the studio"]}>
              {trend.map((point) => (
                <tr key={point.date} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{point.date}</td>
                  <Count value={point.signups} />
                  <Count value={point.logins} />
                  <Count value={point.studioUsers} />
                </tr>
              ))}
            </Table>
          </div>
        </details>
      </ChartFrame>

      {/* ── Cohorts ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          By signup week
        </h2>
        {report.cohorts.length === 0 ? (
          <EmptyRow message="No signups in this range, so there are no cohorts to compare." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-3">Week of</th>
                  {stages.map((stage, i) => (
                    <th key={stage.key} className="px-3 py-3 text-right" title={stage.label}>
                      {i + 1}. {stage.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.cohorts.map((cohort) => (
                  <tr key={cohort.week} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-medium tabular-nums text-slate-900">
                      {cohort.week}
                    </td>
                    {cohort.users.map((count, i) => (
                      <td key={stages[i].key} className="px-3 py-3 text-right tabular-nums text-slate-700">
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
          Read down a column to see whether a change to the studio helped: the percentage is that
          step as a share of the same week&rsquo;s signups. Weeks are Bangkok weeks starting
          Monday.
        </p>
      </section>

      {/* ── Definitions ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Step definitions
        </h2>
        <Table headers={["Step", "Where", "Reached", "Recorded", "Counted from"]} textColumns={[1, 4]}>
          {stages.map((stage, i) => (
            <tr key={stage.key} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">
                {i + 1}. {stage.label}
              </td>
              <td className="px-4 py-3 text-slate-500">{stage.where}</td>
              <Count value={stage.users} />
              <Count value={stage.recorded} />
              <td className="px-4 py-3 text-slate-500">{stage.hint}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-slate-400">
          Clicks inside each step (remaking the voice, editing the storyboard, render failures,
          downloads) are on{" "}
          <a className="underline" href={ROUTES.ADMIN_ANALYTICS_STUDIO}>
            Studio Activity
          </a>
          .
        </p>
      </section>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function countAt(stages: { key: string; users: number }[], key: string): string {
  return (stages.find((stage) => stage.key === key)?.users ?? 0).toLocaleString();
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
  return (
    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{value.toLocaleString()}</td>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-500">
      {message}
    </div>
  );
}
