import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { HourHeatmap } from "@/features/admin/charts/HourHeatmap";
import { GroupedBarChart } from "@/features/admin/charts/GroupedBarChart";
import { TimeSeriesChart } from "@/features/admin/charts/TimeSeriesChart";
import { attempt } from "@/features/admin/attempt";
import { AdminErrorPanel } from "@/features/admin/components/AdminErrorPanel";
import { formatDuration } from "@/services/admin/analyticsShared";
import { adminStudioActivityService } from "@/services/admin/AdminStudioActivityService";
import { ROUTES } from "@/config/routes";

export const metadata: Metadata = { title: "Studio Activity — Admin" };

/**
 * What people do on each studio step, and what goes wrong there.
 *
 * Replaces "Approval clicks" (Oct 2026): video generation needs no admin or
 * staff approval any more, and every gate is the requester's own button in
 * the studio. Screens and clicks come from studio_events (migration 041);
 * pipeline timing and phone renders come from the pipeline tables and are
 * retroactive.
 */
export default async function AdminStudioActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  await requireRole(Role.Admin);
  const range = parseDateRange(await searchParams);

  const reportAttempt = await attempt(
    () => adminStudioActivityService.getReport({ from: range.from, to: range.to }),
    "Studio activity"
  );

  const header = (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Studio Activity</h1>
      <p className="mt-1 text-sm text-slate-500">
        What people do on each studio step — how many get there, how long they stay, which
        buttons they press — and what goes wrong. Everything here happened inside the range;
        the new-user view is the{" "}
        <a className="underline" href={ROUTES.ADMIN_ANALYTICS_FUNNEL}>
          Conversion Funnel
        </a>
        .
      </p>
    </div>
  );

  if (!reportAttempt.ok) {
    return (
      <div className="space-y-8">
        {header}
        <AdminErrorPanel title="Studio activity could not be loaded" error={reportAttempt.error} />
      </div>
    );
  }

  const report = reportAttempt.data;
  const { totals } = report;
  const renderTotal = totals.phoneRendersOk + totals.phoneRendersFailed;
  const anyStepData = report.steps.some((step) => step.views > 0);
  const firstStepUsers = report.steps[0]?.users ?? 0;

  return (
    <div className="space-y-8">
      {header}

      <DateRangeBar fromInput={range.fromInput} toInput={range.toInput} days={range.days} />
      <RangeCaption days={range.days} />

      {!report.studioTracking ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Studio step tracking is not switched on in this database</p>
          <p className="mt-1">
            <code>studio_events</code> does not exist, so the step and click sections are empty.
            Apply <code>src/db/migrations/041_studio_events.sql</code>. The pipeline and phone
            render sections below are unaffected.
          </p>
        </div>
      ) : (
        !anyStepData && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No studio screens recorded in this range yet. Tracking starts once this server
            version is deployed; app builds need nothing new, because the studio is a web page
            inside the app.
          </div>
        )
      )}

      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <StatTileGrid>
        <StatTile
          label="New users"
          value={totals.newUsers}
          hint={`${totals.studioUsers.toLocaleString()} people used the studio · ${totals.studioVisits.toLocaleString()} visits`}
        />
        <StatTile
          label="Videos started"
          value={totals.submissions}
          hint={`${totals.briefsSaved.toLocaleString()} briefs saved → ${totals.submissions.toLocaleString()} submitted`}
        />
        <StatTile
          label="Main videos made"
          value={totals.mainVideos}
          hint={`${totals.finished.toLocaleString()} finished with every channel shape`}
          tone="good"
        />
        <StatTile
          label="Phone renders failed"
          value={totals.phoneRendersFailed}
          hint={
            renderTotal > 0
              ? `${percent((totals.phoneRendersOk / renderTotal) * 100)} of ${renderTotal.toLocaleString()} parts succeeded`
              : "no phone render parts in range"
          }
          tone="urgent"
        />
      </StatTileGrid>

      {/* ── Steps ────────────────────────────────────────────────────────── */}
      <ChartFrame
        title="People on each studio step"
        description="Distinct users who opened each screen, and how many visits ended on it (the person left the studio there)."
        footnote="A visit ending on Render or Channels is often fine — the person closed the app while the video was being made. A visit ending on Brief or Photos & clips is a lost start."
      >
        {anyStepData ? (
          <GroupedBarChart
            data={report.steps.map((step) => ({
              category: step.label,
              users: step.users,
              ended: step.visitsEndedHere,
            }))}
            series={[
              { key: "users", label: "Users who opened it" },
              { key: "ended", label: "Visits that ended here" },
            ]}
          />
        ) : (
          <ChartEmpty message="No studio screens recorded in this range." />
        )}
      </ChartFrame>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Step by step — time spent and clicks
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Time on a step is from opening it to the next screen (or the visit&rsquo;s last
          event), capped at 2 hours. &ldquo;Kept&rdquo; is the share of the first step&rsquo;s
          users who opened this one. Each click line shows how many times, by how many people, on
          how many videos.
        </p>
        <div className="space-y-4">
          {report.steps.map((step, i) => (
            <div key={step.step} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <p className="font-semibold text-slate-900">
                  <span className="mr-2 text-xs tabular-nums text-slate-400">{i + 1}</span>
                  {step.label}
                </p>
                <p className="text-xs tabular-nums text-slate-500">
                  <strong className="text-slate-800">{step.users.toLocaleString()}</strong> users ·{" "}
                  {step.views.toLocaleString()} views · median{" "}
                  <strong className="text-slate-800">
                    {step.medianSeconds === null ? "—" : formatDuration(step.medianSeconds)}
                  </strong>{" "}
                  · ended {step.visitsEndedHere.toLocaleString()} of {step.visits.toLocaleString()} visits
                  {i > 0 && firstStepUsers > 0 && (
                    <> · kept {percent((step.users / firstStepUsers) * 100)}</>
                  )}
                </p>
              </div>
              {step.actions.length === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-400">No clicks recorded on this step.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-50">
                    {step.actions.map((action) => (
                      <tr key={action.action}>
                        <td className={`px-4 py-2 ${isProblem(action.action) ? "text-red-700" : "text-slate-700"}`}>
                          {action.label}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                          {action.count.toLocaleString()}×
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                          {action.users.toLocaleString()} users
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                          {action.requests.toLocaleString()} videos
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
        {report.voiceRemakesPerRequest !== null && (
          <p className="mt-2 text-xs text-slate-500">
            On average a video&rsquo;s voice was made again{" "}
            <strong>{report.voiceRemakesPerRequest.toFixed(1)}</strong> times after it first
            arrived — a high number means the first voice or script is often not what people want.
          </p>
        )}
      </section>

      {/* ── Pipeline waits ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Where videos wait
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          From the pipeline&rsquo;s step history (retroactive): how long each point lasted before
          the next one began. <strong>User</strong> rows are the person deciding — there is no
          admin approval anywhere; <strong>Work</strong> rows are the AI or the phone. &ldquo;Waiting
          now&rdquo; is every unfinished video sitting there today, of any age.
        </p>
        <Table
          headers={["Point in the pipeline", "Who", "Reached", "Median", "Slowest 10%", "Waiting now"]}
          textColumns={[1]}
        >
          {report.pipeline.map((row) => (
            <tr key={row.key} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-slate-900">{row.label}</td>
              <td className="px-4 py-3 text-xs">
                <span
                  className={
                    row.kind === "decision"
                      ? "rounded bg-amber-100 px-2 py-0.5 text-amber-800"
                      : "rounded bg-slate-100 px-2 py-0.5 text-slate-600"
                  }
                >
                  {row.kind === "decision" ? "User" : "Work"}
                </span>
              </td>
              <Count value={row.reached} />
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {row.medianSeconds === null ? "—" : formatDuration(row.medianSeconds)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                {row.p90Seconds === null ? "—" : formatDuration(row.p90Seconds)}
              </td>
              <Count value={row.waitingNow} />
            </tr>
          ))}
        </Table>
      </section>

      {/* ── What went wrong ──────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Videos that failed, by step"
          description="Jobs that ended failed inside the range, by the step they failed at."
        >
          {report.pipelineFailures.length === 0 ? (
            <ChartEmpty message="No failed videos in this range." />
          ) : (
            <ListTable rows={report.pipelineFailures} />
          )}
        </ChartFrame>
        <ChartFrame
          title="Phone render errors"
          description="The most common reasons a phone render part failed (stage · platform — reason)."
        >
          {report.phoneErrors.length === 0 ? (
            <ChartEmpty message="No failed phone render parts in this range." />
          ) : (
            <ListTable rows={report.phoneErrors} />
          )}
        </ChartFrame>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Phone renders by platform and part
        </h2>
        {report.phoneRenders.length === 0 ? (
          <EmptyRow message="No phone render attempts in this range." />
        ) : (
          <Table
            headers={["Platform", "Part", "Attempts", "Succeeded", "Failed", "Stopped / lapsed", "Success", "Median time"]}
            textColumns={[1]}
          >
            {report.phoneRenders.map((row) => (
              <tr key={`${row.platform}-${row.stage}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{row.platform}</td>
                <td className="px-4 py-3 text-slate-700">{row.stage}</td>
                <Count value={row.attempts} />
                <Count value={row.completed} />
                <td className={`px-4 py-3 text-right tabular-nums ${row.failed > 0 ? "text-red-700" : "text-slate-700"}`}>
                  {row.failed.toLocaleString()}
                </td>
                <Count value={row.abandoned} />
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {row.attempts > 0 ? percent((row.completed / row.attempts) * 100) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {row.medianSeconds === null ? "—" : formatDuration(row.medianSeconds)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {/* ── Daily + hours ────────────────────────────────────────────────── */}
      <ChartFrame
        title="Per day"
        description="New users, people active in the studio, videos submitted and main videos made, per Bangkok day."
      >
        {report.daily.some((d) => d.newUsers + d.studioUsers + d.submissions + d.mainVideos > 0) ? (
          <TimeSeriesChart
            data={report.daily.map((point) => ({
              date: point.date,
              newUsers: point.newUsers,
              studioUsers: point.studioUsers,
              submissions: point.submissions,
              mainVideos: point.mainVideos,
            }))}
            series={[
              { key: "newUsers", label: "New users" },
              { key: "studioUsers", label: "Active in the studio" },
              { key: "submissions", label: "Videos submitted" },
              { key: "mainVideos", label: "Main videos made" },
            ]}
          />
        ) : (
          <ChartEmpty message="Nothing happened in this range." />
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
            Show daily figures ({report.daily.length} days)
          </summary>
          <div className="mt-3">
            <Table headers={["Day", "New users", "Active in studio", "Submitted", "Main videos"]}>
              {report.daily.map((point) => (
                <tr key={point.date} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{point.date}</td>
                  <Count value={point.newUsers} />
                  <Count value={point.studioUsers} />
                  <Count value={point.submissions} />
                  <Count value={point.mainVideos} />
                </tr>
              ))}
            </Table>
          </div>
        </details>
      </ChartFrame>

      <ChartFrame
        title="When people use the studio"
        description="Screens opened and buttons pressed, by Bangkok day of week and hour."
      >
        <HourHeatmap
          cells={report.hours}
          emptyMessage="No studio activity recorded in this range."
        />
      </ChartFrame>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

const PROBLEM_ACTIONS = new Set([
  "quota_blocked",
  "submit_failed",
  "originals_missing",
  "script_approve_failed",
  "voice_failed",
  "render_start_failed",
  "render_failed",
  "channels_failed",
  "download_blocked",
]);

function isProblem(action: string): boolean {
  return PROBLEM_ACTIONS.has(action);
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function ListTable({ rows }: { rows: { label: string; count: number }[] }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-slate-100">
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="py-2 pr-4 text-slate-700">{row.label}</td>
            <td className="py-2 text-right tabular-nums font-semibold text-slate-900">
              {row.count.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
