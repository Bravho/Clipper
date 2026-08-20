import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { HourHeatmap } from "@/features/admin/charts/HourHeatmap";
import { GroupedBarChart } from "@/features/admin/charts/GroupedBarChart";
import {
  ABANDONMENT_THRESHOLD_HOURS,
  adminApprovalMetricsService,
  formatDuration,
  gateStepLabel,
  type ApprovalMetrics,
} from "@/services/admin/AdminApprovalMetricsService";

export const metadata: Metadata = { title: "Approval Clicks — Admin" };

/**
 * "When do users click approve, and how many times?"
 *
 * The behavioural half of the CPU-sizing question. Every click at a review gate
 * releases the next heavy render step, so the shape of this page — the hour of
 * the week the clicks bunch into, and how many clicks a video costs — IS the
 * arrival process the capacity model on `/admin/analytics/capacity` consumes.
 *
 * The one thing this page can say that nothing else in the codebase can is
 * human vs auto. `_autoAdvanceIfEnabled()` reuses a real approver id, so an
 * express-lane auto-approval and a human click write identical step-history rows
 * and identical `*_approved_by` columns; `pipeline_gate_events.actor_source`
 * (migration 028) is the only column that separates them. When that table has no
 * rows for the range the page falls back to reconstructing clicks from step
 * history and says, everywhere, that the numbers are estimates.
 */

/** Sunday-first, matching Postgres `EXTRACT(DOW)` and `<HourHeatmap>`. */
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface ApprovalsSearchParams {
  from?: string | string[];
  to?: string | string[];
}

export default async function AdminApprovalAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<ApprovalsSearchParams>;
}) {
  await requireRole(Role.Admin);

  const query = await searchParams;
  const range = parseDateRange(query);
  const metrics = await adminApprovalMetricsService.getMetrics({
    from: range.from,
    to: range.to,
  });

  const estimated = metrics.mode === "estimated";
  /** Suffix appended to every headline so a screenshot cannot lose the caveat. */
  const tag = estimated ? " (estimated)" : "";

  const totalHumanClicks = metrics.actorSplit.reduce(
    (sum, row) => sum + (estimated ? row.total : row.human),
    0
  );
  const totalAuto = metrics.actorSplit.reduce((sum, row) => sum + row.auto, 0);
  const overallDwell = weightedMedian(metrics.dwell);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Approval clicks &amp; gate waits</h1>
        <p className="mt-1 text-sm text-slate-500">
          When requesters click through the review gates, how many clicks a video costs,
          and how long each gate holds a job. This is the arrival profile the capacity
          model consumes.
        </p>
      </div>

      <DateRangeBar fromInput={range.fromInput} toInput={range.toInput} days={range.days} />
      <RangeCaption days={range.days} />

      <ModeBanner metrics={metrics} />

      <StatTileGrid>
        <StatTile
          label={estimated ? "Gate transitions (estimated)" : "Human approval clicks"}
          value={totalHumanClicks.toLocaleString()}
          hint={
            estimated
              ? "Reconstructed from step history — includes auto-approvals"
              : `${totalAuto.toLocaleString()} more were cleared automatically`
          }
        />
        <StatTile
          label={`Peak hour${tag}`}
          value={
            metrics.peak
              ? `${metrics.peak.ratePerHour.toFixed(1)}/h`
              : "—"
          }
          hint={
            metrics.peak
              ? `${DAY_LABELS[metrics.peak.dayOfWeek]} ${hourLabel(metrics.peak.hour)} · ${metrics.peak.count} clicks over ${metrics.peak.occurrences} occurrence${metrics.peak.occurrences === 1 ? "" : "s"}`
              : "No clicks recorded in this range"
          }
        />
        <StatTile
          label={`Median gate wait${tag}`}
          value={overallDwell === null ? "—" : formatDuration(overallDwell)}
          hint="Median of the per-step medians, weighted by sample count"
        />
        <StatTile
          label="Gates open right now"
          value={metrics.openNowTotal}
          hint={`${metrics.stalledNowTotal} open longer than ${ABANDONMENT_THRESHOLD_HOURS}h`}
          tone={metrics.stalledNowTotal > 0 ? "urgent" : "default"}
        />
      </StatTileGrid>

      {/* ── 1. Time of day × day of week ─────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          When the clicks happen
        </h2>
        <ChartFrame
          title={`Approval clicks by hour and weekday${tag}`}
          description={
            estimated
              ? "Reconstructed click times. Human and automatic approvals cannot be separated in this mode."
              : "Human resolutions only — express-lane auto-approvals fire whenever the worker finishes and would flatten the peak."
          }
          footnote={
            metrics.peak ? (
              <>
                Busiest slot: {DAY_LABELS[metrics.peak.dayOfWeek]} {hourLabel(metrics.peak.hour)} —{" "}
                <span className="tabular-nums">{metrics.peak.count}</span> clicks across{" "}
                <span className="tabular-nums">{metrics.peak.occurrences}</span> occurrence
                {metrics.peak.occurrences === 1 ? "" : "s"} ={" "}
                <span className="tabular-nums">{metrics.peak.ratePerHour.toFixed(2)}</span> clicks/hour.
                That rate is λ in the capacity model. All hours Asia/Bangkok.
              </>
            ) : (
              "All hours Asia/Bangkok."
            )
          }
        >
          <HourHeatmap
            cells={metrics.heatmap}
            emptyMessage="No approval clicks recorded in this range."
          />
        </ChartFrame>
      </section>

      {/* ── 2. Clicks per job ────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Clicks per finished video
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Lane</th>
                <th className="px-4 py-3 font-medium">Completed jobs</th>
                <th className="px-4 py-3 font-medium">
                  {estimated ? "Total transitions" : "Total human clicks"}
                </th>
                <th className="px-4 py-3 font-medium">Mean per job</th>
                <th className="px-4 py-3 font-medium">Median per job</th>
              </tr>
            </thead>
            <tbody>
              {metrics.clicksPerJob.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={5}>
                    No completed jobs with approval activity in this range.
                  </td>
                </tr>
              )}
              {metrics.clicksPerJob.map((row) => (
                <tr key={row.lane} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">
                      {row.lane === "express" ? "Express lane" : "Manual"}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">
                      {row.lane === "express"
                        ? "auto_approve_remaining = true"
                        : "every gate clicked"}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{row.jobs}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{row.totalClicks}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-900">
                    {row.meanClicks.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-900">
                    {row.medianClicks.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          A manual job passes roughly eight gates; an express-lane job stops at about
          three and the pipeline clears the rest. The difference is the click budget the
          express lane buys back — and, since an unattended gate holds a job open, the
          wall-clock it removes.
          {estimated &&
            " In estimated mode both lanes include automatic advances, so the express-lane figure is an upper bound on human clicks."}
        </p>
      </section>

      {/* ── 3. Human vs auto per gate ────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Who resolved each gate
        </h2>

        {estimated ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <ChartEmpty
              height={160}
              message="Human vs automatic cannot be separated before instrumentation: _autoAdvanceIfEnabled() reuses a real approver id, so an express-lane approval and a human click write identical step-history rows. The volume per gate is shown below; the actor is genuinely unknown."
            />
          </div>
        ) : (
          <ChartFrame
            title="Resolutions per gate, by actor"
            description="Every resolution recorded in the range, split by pipeline_gate_events.actor_source."
            footnote="The same numbers are in the table below — bar colour alone is never the only encoding on this surface."
          >
            {metrics.actorSplit.length === 0 ? (
              <ChartEmpty message="No gate resolutions recorded in this range." />
            ) : (
              <GroupedBarChart
                data={metrics.actorSplit.map((row) => ({
                  category: gateStepLabel(row.step),
                  human: row.human,
                  auto: row.auto,
                  other: row.system + row.unattributed,
                }))}
                series={[
                  { key: "human", label: "Human" },
                  { key: "auto", label: "Express lane (auto)" },
                  { key: "other", label: "System / unattributed" },
                ]}
              />
            )}
          </ChartFrame>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Gate</th>
                {!estimated && (
                  <>
                    <th className="px-4 py-3 font-medium">Human</th>
                    <th className="px-4 py-3 font-medium">Auto</th>
                    <th className="px-4 py-3 font-medium">System</th>
                    <th className="px-4 py-3 font-medium">Unattributed</th>
                    <th className="px-4 py-3 font-medium">Human share</th>
                  </>
                )}
                <th className="px-4 py-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {metrics.actorSplit.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={estimated ? 2 : 7}>
                    No gate resolutions recorded in this range.
                  </td>
                </tr>
              )}
              {metrics.actorSplit.map((row) => (
                <tr key={row.step} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{gateStepLabel(row.step)}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{row.step}</span>
                  </td>
                  {!estimated && (
                    <>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{row.human}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{row.auto}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{row.system}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{row.unattributed}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-900">
                        {row.total > 0 ? `${Math.round((row.human / row.total) * 100)}%` : "—"}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 tabular-nums text-slate-900">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 4. Dwell time per gate ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          How long each gate holds a job
        </h2>
        <ChartFrame
          title={`Median wait per gate${tag}`}
          description="The gate with the longest median is where requesters stall — and where a job holds its inputs, its queue slot and its storage for nothing."
          footnote="Exact values, including the p90 tail, are in the table below."
        >
          {metrics.dwell.length === 0 ? (
            <ChartEmpty message="No resolved gates with a recorded wait in this range." />
          ) : (
            <GroupedBarChart
              data={metrics.dwell.map((row) => ({
                category: gateStepLabel(row.step),
                median: Math.round(row.medianSeconds),
              }))}
              series={[{ key: "median", label: "Median wait" }]}
              valueFormat="duration"
            />
          )}
        </ChartFrame>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Gate</th>
                <th className="px-4 py-3 font-medium">Samples</th>
                <th className="px-4 py-3 font-medium">Mean</th>
                <th className="px-4 py-3 font-medium">Median</th>
                <th className="px-4 py-3 font-medium">p90</th>
              </tr>
            </thead>
            <tbody>
              {metrics.dwell.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={5}>
                    No resolved gates with a recorded wait in this range.
                  </td>
                </tr>
              )}
              {metrics.dwell.map((row) => (
                <tr key={row.step} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{gateStepLabel(row.step)}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{row.step}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{row.samples}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {formatDuration(row.meanSeconds)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-900">
                    {formatDuration(row.medianSeconds)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {formatDuration(row.p90Seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {estimated && (
          <p className="mt-2 text-xs text-slate-400">
            Estimated: the wait is the gap between the gate&apos;s step-history row and the
            row for the step the click started. It therefore includes any delay between
            the click landing and the next step being written.
          </p>
        )}
      </section>

      {/* ── 5. Notification effectiveness ────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Does the push notification shorten the wait?
        </h2>
        {metrics.notification === null ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <ChartEmpty
              height={140}
              message="Not answerable before instrumentation: video_generation_step_history has no notification timestamp. pipeline_gate_events.notified_at records when the push actually went out; this comparison appears once the table has rows for the selected range."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="table w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-medium">Push sent?</th>
                    <th className="px-4 py-3 font-medium">Samples</th>
                    <th className="px-4 py-3 font-medium">Mean wait</th>
                    <th className="px-4 py-3 font-medium">Median wait</th>
                    <th className="px-4 py-3 font-medium">p90 wait</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.notification.length === 0 && (
                    <tr>
                      <td className="px-4 py-3 text-slate-500" colSpan={5}>
                        No human gate resolutions with a recorded wait in this range.
                      </td>
                    </tr>
                  )}
                  {metrics.notification.map((row) => (
                    <tr
                      key={String(row.notified)}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.notified ? "Notified" : "No push recorded"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{row.samples}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {formatDuration(row.meanSeconds)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-900">
                        {formatDuration(row.medianSeconds)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {formatDuration(row.p90Seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              A NULL <span className="font-mono">notified_at</span> is data, not a gap: the
              express lane deliberately suppresses push on gates it clears itself, and a
              revoked or failed device leaves it NULL too. This is an observed difference,
              not a controlled experiment — the notified and un-notified gates are not the
              same gates, so read it as a signal to test, not as a measured effect.
            </p>
          </>
        )}
      </section>

      {/* ── 6. Abandonment ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Abandoned and stalled gates
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Gate</th>
                <th className="px-4 py-3 font-medium">Open now</th>
                <th className="px-4 py-3 font-medium">
                  Open &gt; {ABANDONMENT_THRESHOLD_HOURS}h
                </th>
                {!estimated && <th className="px-4 py-3 font-medium">Closed as abandoned</th>}
              </tr>
            </thead>
            <tbody>
              {metrics.abandonment.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={estimated ? 3 : 4}>
                    No open or abandoned gates.
                  </td>
                </tr>
              )}
              {metrics.abandonment.map((row) => (
                <tr key={row.step} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{gateStepLabel(row.step)}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{row.step}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{row.openNow}</td>
                  <td
                    className={
                      row.stalled > 0
                        ? "px-4 py-3 tabular-nums font-medium text-red-700"
                        : "px-4 py-3 tabular-nums text-slate-700"
                    }
                  >
                    {row.stalled}
                  </td>
                  {!estimated && (
                    <td className="px-4 py-3 tabular-nums text-slate-700">{row.abandoned}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {estimated
            ? `Estimated: an open gate is an active job parked on an awaiting_* step, aged by video_generation_jobs.updated_at — which any unrelated write to the job also bumps, so the ${ABANDONMENT_THRESHOLD_HOURS}h count is a lower bound.`
            : `Counted from gates that OPENED inside the selected range; "open now" and the ${ABANDONMENT_THRESHOLD_HOURS}h threshold are evaluated as of now, so a gate opened weeks ago and still open still counts as open.`}
        </p>
      </section>
    </div>
  );
}

/**
 * The banner that keeps an estimate from being read as a measurement.
 *
 * Rendered above every number rather than as a footnote, because this page will
 * be screenshotted into a hardware discussion and the caveat has to travel with
 * the picture.
 */
function ModeBanner({ metrics }: { metrics: ApprovalMetrics }) {
  if (metrics.mode === "instrumented") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <span className="font-medium text-slate-700">Measured.</span> Every number on this
        page comes from <span className="font-mono">pipeline_gate_events</span>, which
        records the actor and the open → resolve latency of each gate.
        {metrics.firstInstrumentedAt && (
          <> Instrumentation began {metrics.firstInstrumentedAt.toISOString().slice(0, 10)}.</>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
      <span className="font-medium">
        Estimated (pre-instrumentation) — every number on this page is an approximation.
      </span>{" "}
      <span className="font-mono">pipeline_gate_events</span> has no rows in this range, so
      clicks are reconstructed from{" "}
      <span className="font-mono">video_generation_step_history</span>: the timestamp of
      the row for the step each click started. Two consequences worth stating plainly —{" "}
      <strong>human and automatic approvals cannot be separated</strong> (the express lane
      writes identical rows), and the wait includes any lag between the click landing and
      the next step being written.
      {metrics.firstInstrumentedAt ? (
        <>
          {" "}
          Real gate events exist from{" "}
          {metrics.firstInstrumentedAt.toISOString().slice(0, 10)} — select a range at or
          after that date for measured numbers.
        </>
      ) : (
        <> No gate events have been recorded yet at all.</>
      )}
    </div>
  );
}

/** `13` → `13:00–14:00`. */
function hourLabel(hour: number): string {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00–${String(next).padStart(2, "0")}:00`;
}

/**
 * A single headline dwell figure across gates.
 *
 * The per-step medians are weighted by their own sample counts rather than
 * simply averaged: the per-scene gates fire several times per job and a plain
 * mean of medians would give a gate seen twice the same weight as one seen four
 * hundred times. Still an approximation of the true pooled median — the exact
 * value would need the raw distribution — so it is labelled as what it is.
 */
function weightedMedian(rows: { medianSeconds: number; samples: number }[]): number | null {
  const total = rows.reduce((sum, row) => sum + row.samples, 0);
  if (total === 0) return null;
  return rows.reduce((sum, row) => sum + row.medianSeconds * row.samples, 0) / total;
}
