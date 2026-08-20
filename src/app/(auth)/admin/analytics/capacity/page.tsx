import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/helpers";
import { Role } from "@/domain/enums/Role";
import { parseDateRange } from "@/features/admin/dateRange";
import { DateRangeBar, RangeCaption } from "@/features/admin/components/DateRangeBar";
import { StatTile, StatTileGrid } from "@/features/admin/components/StatTile";
import { ChartEmpty, ChartFrame } from "@/features/admin/charts/ChartFrame";
import { TimeSeriesChart } from "@/features/admin/charts/TimeSeriesChart";
import { GroupedBarChart } from "@/features/admin/charts/GroupedBarChart";
import {
  DEFAULT_TARGET_MINUTES,
  SAFE_UTILISATION,
  adminCapacityService,
  formatDuration,
  parseTargetMinutes,
  type CapacityReport,
} from "@/services/admin/AdminCapacityService";

export const metadata: Metadata = { title: "Render Capacity — Admin" };

/**
 * How much CPU the render worker needs, argued from measured numbers.
 *
 * THE CPU CONSUMER IS NOT THE WEB SERVER. The droplet orchestrates and waits on
 * network-bound AI APIs; the compute is the Mac Mini worker running FFmpeg and
 * Remotion. Sizing the droplet from this page would be sizing the wrong machine.
 *
 * Structure of the argument, in order: the four measured inputs, the queueing
 * model built on them, then the two things that check the model — the purely
 * empirical wait-vs-queue-depth curve, which assumes nothing, and Little's Law,
 * which must hold for any stable queue and so only fails when the data is
 * incomplete. Anything modelled is labelled modelled, next to the inputs it was
 * computed from, because this page is where hardware spend gets justified.
 */

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface CapacitySearchParams {
  from?: string | string[];
  to?: string | string[];
  targetMinutes?: string | string[];
}

export default async function AdminCapacityAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<CapacitySearchParams>;
}) {
  await requireRole(Role.Admin);

  const query = await searchParams;
  const range = parseDateRange(query);
  const targetMinutes = parseTargetMinutes(query.targetMinutes);

  const report = await adminCapacityService.getReport(
    { from: range.from, to: range.to },
    targetMinutes
  );
  const { model } = report;

  /** Nothing finished on the worker in this range — the model has no S to use. */
  const noServiceData = model.service.jobs === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Render capacity &amp; CPU sizing</h1>
        <p className="mt-1 text-sm text-slate-500">
          How many concurrent renders the Mac Mini worker needs to keep queue waits
          acceptable, from measured arrival rate and measured service time.
        </p>
      </div>

      <DateRangeBar fromInput={range.fromInput} toInput={range.toInput} days={range.days} />
      <RangeCaption days={range.days} />

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <span className="font-medium text-slate-700">What consumes CPU here.</span> Not the
        web server — it orchestrates and waits on network-bound AI APIs. The compute is the
        Mac Mini worker running FFmpeg and Remotion. Addendum B of
        <span className="font-mono"> docs/storage-lifecycle-design.md</span> measures an
        M4/16&nbsp;GB at 1–2 concurrent Remotion renders (each spawns Chromium at 1–3&nbsp;GB)
        and ~2–4 minutes of render+encode per job, against 1–55&nbsp;s of transfer. Compute
        dominates transfer by an order of magnitude, so the question is concurrency, not
        bandwidth.
      </div>

      {/* ── Measured inputs ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Measured inputs
        </h2>

        <StatTileGrid>
          <StatTile
            label="λ — peak-hour arrivals"
            value={`${model.arrivals.peakPerHour.toFixed(2)}/h`}
            hint={
              model.arrivals.peakDayOfWeek !== null && model.arrivals.peakHour !== null
                ? `${DAY_LABELS[model.arrivals.peakDayOfWeek]} ${hourLabel(model.arrivals.peakHour)} · measured`
                : "No jobs entered the render queue in this range"
            }
          />
          <StatTile
            label="S — CPU-seconds per job"
            value={noServiceData ? "—" : formatDuration(model.service.meanSecondsPerJob)}
            hint={
              noServiceData
                ? "No finished render tasks in this range"
                : `mean of ${model.service.jobs} jobs (${model.service.tasks} tasks) · measured`
            }
          />
          <StatTile
            label="c — concurrent render slots"
            value={model.currentServers}
            hint={`${model.workerCount || "no"} worker${model.workerCount === 1 ? "" : "s"} measured × RENDER_CONCURRENCY ${model.concurrencyPerWorker} (config)`}
          />
          <StatTile
            label="ρ — utilisation at peak"
            value={formatRatio(model.utilisation)}
            hint={`modelled: λ·S / c · ${SAFE_UTILISATION * 100}% is the safe ceiling`}
            tone={model.utilisation >= SAFE_UTILISATION ? "urgent" : "good"}
          />
        </StatTileGrid>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Meaning</th>
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Where it comes from</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="px-4 py-3 font-mono text-slate-900">λ</td>
                <td className="px-4 py-3 text-slate-700">Peak-hour job arrival rate</td>
                <td className="px-4 py-3 tabular-nums text-slate-900">
                  {model.arrivals.peakPerHour.toFixed(2)} jobs/h
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  Measured — {model.arrivals.peakJobs} jobs across{" "}
                  {model.arrivals.peakOccurrences} occurrence
                  {model.arrivals.peakOccurrences === 1 ? "" : "s"} of the busiest
                  weekday-hour, from <span className="font-mono">MIN(render_tasks.enqueued_at)</span>{" "}
                  per job. Range mean is {model.arrivals.meanPerHour.toFixed(2)}/h over{" "}
                  {model.arrivals.totalJobs} jobs.
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="px-4 py-3 font-mono text-slate-900">S</td>
                <td className="px-4 py-3 text-slate-700">Service demand per job</td>
                <td className="px-4 py-3 tabular-nums text-slate-900">
                  {noServiceData ? "—" : formatDuration(model.service.meanSecondsPerJob)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  Measured —{" "}
                  <span className="font-mono">SUM(render_tasks.duration_ms)</span> per job,
                  averaged. Median {formatDuration(model.service.medianSecondsPerJob)}, p90{" "}
                  {formatDuration(model.service.p90SecondsPerJob)}. Failed tasks excluded.
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="px-4 py-3 font-mono text-slate-900">c</td>
                <td className="px-4 py-3 text-slate-700">Concurrent render slots</td>
                <td className="px-4 py-3 tabular-nums text-slate-900">{model.currentServers}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  Config × measured — <span className="font-mono">RENDER_CONCURRENCY</span> ={" "}
                  {model.concurrencyPerWorker} per worker, {model.workerCount} distinct worker
                  {model.workerCount === 1 ? "" : "s"} claimed a task in this range.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-slate-900">ρ</td>
                <td className="px-4 py-3 text-slate-700">Utilisation at the peak hour</td>
                <td className="px-4 py-3 tabular-nums text-slate-900">
                  {formatRatio(model.utilisation)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Modelled</span> — λ·S / c ={" "}
                  {model.arrivals.peakPerHour.toFixed(2)} ×{" "}
                  {(model.service.meanSecondsPerJob / 3600).toFixed(4)}h /{" "}
                  {model.currentServers}. Offered load a ={" "}
                  {model.offeredLoad.toFixed(3)} Erlangs.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── The model ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Modelled concurrency requirement
        </h2>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          {noServiceData ? (
            <ChartEmpty
              height={140}
              message="No finished render tasks in this range, so there is no measured service time to model with. Either no video was rendered, or every job ran through the inline fallback (which writes no render_tasks row). Widen the range, or check that the worker is online."
            />
          ) : (
            <>
              <p className="text-sm text-slate-700">
                <span className="font-medium">Modelled result.</span>{" "}
                {model.recommendedServers === null ? (
                  <>
                    No concurrency up to 16 keeps the p90 queue wait under {targetMinutes}{" "}
                    minutes at the measured peak. Either the target is tighter than the
                    service time allows (a single job takes{" "}
                    {formatDuration(model.service.meanSecondsPerJob)}), or the arrival rate
                    genuinely exceeds what one box can absorb.
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-semibold">
                      {model.recommendedServers}
                    </span>{" "}
                    concurrent render slot{model.recommendedServers === 1 ? "" : "s"} keep
                    the modelled p90 queue wait under {targetMinutes} minutes at the measured
                    peak of {model.arrivals.peakPerHour.toFixed(2)} jobs/h. Today there{" "}
                    {model.currentServers === 1 ? "is" : "are"}{" "}
                    <span className="tabular-nums">{model.currentServers}</span>.
                  </>
                )}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Model: M/M/c with Erlang-C, over the measured λ and S above. Target is
                p90 &lt; {targetMinutes} min, overridable with{" "}
                <span className="font-mono">?targetMinutes=</span> (default{" "}
                {DEFAULT_TARGET_MINUTES}).
              </p>
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-medium text-slate-600">What the model assumes.</span>{" "}
                Poisson arrivals, exponentially distributed service times and identical
                servers. Real render times are ~2–4 min plus a tail, which is LESS variable
                than exponential, so Erlang-C overstates the wait — conservative for a
                sizing decision, but a bias, not neutrality. It also cannot see thermal
                throttling or memory pressure on a Mac Mini, which is why the empirical
                curve below matters more than this table where the two disagree.
              </p>
            </>
          )}
        </div>

        {!noServiceData && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="table w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Concurrency</th>
                  <th className="px-4 py-3 font-medium">ρ at peak</th>
                  <th className="px-4 py-3 font-medium">P(has to wait)</th>
                  <th className="px-4 py-3 font-medium">Mean wait</th>
                  <th className="px-4 py-3 font-medium">p90 wait</th>
                  <th className="px-4 py-3 font-medium">
                    Max videos/day at ρ={SAFE_UTILISATION}
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.scenarios.map((scenario) => (
                  <tr
                    key={scenario.servers}
                    className={
                      scenario.servers === model.recommendedServers
                        ? "border-b border-slate-100 bg-slate-50 last:border-0"
                        : "border-b border-slate-100 last:border-0"
                    }
                  >
                    <td className="px-4 py-3 tabular-nums font-medium text-slate-900">
                      {scenario.servers}
                      {scenario.servers === model.recommendedServers && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          smallest that meets the target
                        </span>
                      )}
                      {scenario.servers === model.currentServers && (
                        <span className="ml-2 text-xs font-normal text-slate-500">today</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {formatRatio(scenario.utilisation)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {(scenario.probabilityOfWaiting * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {formatWait(scenario.meanWaitSeconds)}
                    </td>
                    <td
                      className={
                        scenario.meetsTarget
                          ? "px-4 py-3 tabular-nums text-slate-900"
                          : "px-4 py-3 tabular-nums font-medium text-red-700"
                      }
                    >
                      {formatWait(scenario.p90WaitSeconds)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700">
                      {Math.floor(scenario.maxSustainablePerDay).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!noServiceData && (
          <p className="mt-2 text-xs text-slate-400">
            Every figure in this table is <span className="font-medium">modelled</span>, not
            observed. &ldquo;Unbounded&rdquo; means the offered load equals or exceeds the
            slots: the queue never drains and the backlog grows without limit. Max
            videos/day inverts ρ = λ·S/c at the {SAFE_UTILISATION * 100}% ceiling, so it is
            a sustainable rate, not a burst.
          </p>
        )}
      </section>

      {/* ── Worker load over time ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Worker load and queue wait over time
        </h2>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartFrame
            title="Worker CPU per day"
            description="Average and peak of the worker's own CPU samples, by Bangkok day."
            footnote={
              report.workerLoad.length > 0 ? (
                <>
                  Highest daily average{" "}
                  <span className="tabular-nums">{maxOf(report.workerLoad, "avgCpuPercent").toFixed(0)}%</span>{" "}
                  · highest single sample{" "}
                  <span className="tabular-nums">{maxOf(report.workerLoad, "peakCpuPercent").toFixed(0)}%</span>{" "}
                  · deepest queue{" "}
                  <span className="tabular-nums">{maxOf(report.workerLoad, "peakQueueDepth").toFixed(0)}</span>{" "}
                  tasks · {sumOf(report.workerLoad, "samples").toLocaleString()} samples.
                </>
              ) : undefined
            }
          >
            {report.samplingUnavailable ? (
              <ChartEmpty message="No render_worker_samples rows in this range. The worker only started sampling with migration 028 — redeploy scripts/render-worker.ts to begin recording CPU, load and queue depth once a minute. Nothing is inferred in the meantime." />
            ) : (
              <TimeSeriesChart
                data={report.workerLoad.map((point) => ({
                  date: point.date,
                  average: Number(point.avgCpuPercent.toFixed(1)),
                  peak: Number(point.peakCpuPercent.toFixed(1)),
                }))}
                series={[
                  { key: "average", label: "Average CPU %" },
                  { key: "peak", label: "Peak CPU %" },
                ]}
                valueSuffix="%"
                height={220}
              />
            )}
          </ChartFrame>

          <ChartFrame
            title="Queue wait per day"
            description="How long a render task waited before a worker started it, by the Bangkok day it was enqueued."
            footnote={
              report.queueWait.length > 0 ? (
                <>
                  Worst daily p90{" "}
                  <span className="tabular-nums">
                    {formatDuration(maxOf(report.queueWait, "p90WaitSeconds"))}
                  </span>{" "}
                  · worst daily median{" "}
                  <span className="tabular-nums">
                    {formatDuration(maxOf(report.queueWait, "medianWaitSeconds"))}
                  </span>{" "}
                  · {sumOf(report.queueWait, "tasks").toLocaleString()} tasks. Its own chart,
                  never a second axis on the CPU one: percent and seconds share no scale.
                </>
              ) : undefined
            }
          >
            {report.queueWait.length === 0 ? (
              <ChartEmpty message="No render tasks started in this range." />
            ) : (
              <TimeSeriesChart
                data={report.queueWait.map((point) => ({
                  date: point.date,
                  median: Math.round(point.medianWaitSeconds),
                  p90: Math.round(point.p90WaitSeconds),
                }))}
                series={[
                  { key: "median", label: "Median wait (s)" },
                  { key: "p90", label: "p90 wait (s)" },
                ]}
                valueSuffix="s"
                height={220}
              />
            )}
          </ChartFrame>
        </div>
      </section>

      {/* ── Empirical curve ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Measured wait against queue depth
        </h2>

        <ChartFrame
          title="How long a task waits, by how deep the queue was when it arrived"
          description="Every started render task in the range, bucketed by the number of tasks already in the system at the moment it was enqueued."
          footnote="This curve assumes nothing — no Poisson arrivals, no exponential service, no Erlang. Where it and the model disagree, this is right. The knee is the honest capacity ceiling."
        >
          {report.depthBuckets.length === 0 ? (
            <ChartEmpty message="No started render tasks in this range to plot." />
          ) : (
            <GroupedBarChart
              data={report.depthBuckets.map((bucket) => ({
                category: depthLabel(bucket.depth),
                median: Math.round(bucket.medianWaitSeconds),
                p90: Math.round(bucket.p90WaitSeconds),
              }))}
              series={[
                { key: "median", label: "Median wait" },
                { key: "p90", label: "p90 wait" },
              ]}
              valueFormat="duration"
            />
          )}
        </ChartFrame>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Queue depth at enqueue</th>
                <th className="px-4 py-3 font-medium">Tasks</th>
                <th className="px-4 py-3 font-medium">Median wait</th>
                <th className="px-4 py-3 font-medium">Mean wait</th>
                <th className="px-4 py-3 font-medium">p90 wait</th>
              </tr>
            </thead>
            <tbody>
              {report.depthBuckets.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-slate-500" colSpan={5}>
                    No started render tasks in this range.
                  </td>
                </tr>
              )}
              {report.depthBuckets.map((bucket) => (
                <tr key={bucket.depth} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {depthLabel(bucket.depth)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{bucket.tasks}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-900">
                    {formatDuration(bucket.medianWaitSeconds)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {formatDuration(bucket.meanWaitSeconds)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {formatDuration(bucket.p90WaitSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Little's Law ─────────────────────────────────────────────────── */}
      <LittlesLawPanel report={report} />

      {/* ── Other methods ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          What this page does not do
        </h2>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <p className="text-xs text-slate-500">
            Five approaches to the same question that are deliberately not implemented here,
            and when each is the right one to reach for.
          </p>
          <ul className="mt-3 space-y-3 text-sm text-slate-700">
            <li>
              <span className="font-medium text-slate-900">
                A load / soak test at concurrency 1 → 4.
              </span>{" "}
              Run a fixed batch of real jobs at each setting and record wall-clock, CPU
              temperature and swap. This is the only method that catches thermal throttling
              and memory pressure on a Mac Mini — two Remotion renders at 1–3&nbsp;GB each on
              a 16&nbsp;GB box is a memory question, not an arithmetic one. No analytical
              model can see either. Reach for it before buying anything.
            </li>
            <li>
              <span className="font-medium text-slate-900">
                OS-level time series (Prometheus + node_exporter, or Netdata).
              </span>{" "}
              <span className="font-mono">render_worker_samples</span> is a deliberately
              minimal stand-in: one row a minute, self-reported, in the product database.
              Real infra metrics — per-core CPU, disk I/O, network, temperature, at
              second resolution with alerting — belong in a monitoring system, not in a
              table this page queries. Reach for it when the worker becomes something you
              page someone about.
            </li>
            <li>
              <span className="font-medium text-slate-900">
                Persisting the per-invocation FFmpeg timings.
              </span>{" "}
              <span className="font-mono">src/lib/ai/ffmpegService.ts</span> already
              measures every composition and logs it to stdout as{" "}
              <span className="font-mono">[compose:&#123;ratio&#125;] ffmpeg done in X.Xs</span>{" "}
              — then throws it away. Writing those to a table would break S down by ratio
              and by operation, which is the difference between &ldquo;buy more CPU&rdquo;
              and &ldquo;stop rendering the 4:5 nobody downloads&rdquo;. Cheap, and the
              highest-value instrumentation still missing.
            </li>
            <li>
              <span className="font-medium text-slate-900">A cost-per-video curve.</span>{" "}
              Infrastructure cost ÷ videos rendered, plotted against volume. It reframes
              capacity as unit economics and makes the 49&nbsp;credit download price
              auditable against what a video actually costs to produce — including the
              second Mac. Reach for it when the answer has to persuade someone who does not
              care what ρ is.
            </li>
            <li>
              <span className="font-medium text-slate-900">
                A Monte-Carlo scenario simulator.
              </span>{" "}
              Sample from the measured arrival and service distributions instead of assuming
              Poisson and exponential, and project p50/p90 wait at 2×, 5× and 10× today&apos;s
              volume. It drops the assumptions Erlang-C makes and answers &ldquo;what breaks
              first&rdquo; rather than &ldquo;what is the steady state&rdquo;. Reach for it
              once there are enough measured jobs for the distributions to be worth sampling.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

/**
 * Little's Law as a data-quality check.
 *
 * `L = λ·W` holds for any stable queue whatever the distributions, so the two
 * sides disagreeing is evidence about the DATA, not about the system. The usual
 * culprit is named inline: when no worker is fresh the web server runs the step
 * itself and writes no `render_tasks` row at all, so λ is short by exactly those
 * jobs.
 */
function LittlesLawPanel({ report }: { report: CapacityReport }) {
  const check = report.littlesLaw;
  const gap = check.relativeGap;
  const agrees = gap !== null && gap <= 0.25;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Little&apos;s Law cross-check
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-medium">Term</th>
              <th className="px-4 py-3 font-medium">Value</th>
              <th className="px-4 py-3 font-medium">Computed from</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-slate-900">λ</td>
              <td className="px-4 py-3 tabular-nums text-slate-900">
                {check.arrivalsPerHour.toFixed(3)} tasks/h
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {check.tasksMeasured.toLocaleString()} finished{" "}
                <span className="font-mono">render_tasks</span> ÷ hours in range
              </td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-slate-900">W</td>
              <td className="px-4 py-3 tabular-nums text-slate-900">
                {formatDuration(check.meanTimeInSystemSeconds)}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                Mean <span className="font-mono">finished_at − enqueued_at</span>
              </td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-slate-900">λ·W</td>
              <td className="px-4 py-3 tabular-nums text-slate-900">
                {check.predictedInSystem.toFixed(3)}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                Predicted average number of tasks in the system
              </td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">L</td>
              <td className="px-4 py-3 tabular-nums text-slate-900">
                {check.observedInSystem === null ? "—" : check.observedInSystem.toFixed(3)}
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {check.observedInSystem === null ? (
                  <>
                    Not observable — no <span className="font-mono">render_worker_samples</span>{" "}
                    rows in this range, so there is no independent measurement to compare
                    against.
                  </>
                ) : (
                  <>
                    Observed independently — mean sampled{" "}
                    <span className="font-mono">queue_depth</span> over{" "}
                    {check.observedSamples.toLocaleString()} samples (queued + claimed,
                    platform-wide)
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {gap === null ? (
          <>
            Nothing to compare yet. Once the worker is sampling, λ·W and the observed L must
            agree — Little&apos;s Law holds for any stable queue regardless of distribution,
            so a gap means missing timing data, not a broken system.
          </>
        ) : agrees ? (
          <>
            <span className="font-medium text-slate-700">The two agree</span> to within{" "}
            {(gap * 100).toFixed(0)}%. The render-task timing data is internally consistent.
          </>
        ) : (
          <>
            <span className="font-medium text-red-700">The two disagree</span> by{" "}
            {(gap * 100).toFixed(0)}%. Little&apos;s Law cannot be violated by a stable
            queue, so this is missing data rather than a physical result — most often jobs
            that never reached the queue at all.
          </>
        )}{" "}
        {check.jobsWithoutRenderTasks > 0 ? (
          <>
            <span className="tabular-nums font-medium text-slate-700">
              {check.jobsWithoutRenderTasks.toLocaleString()}
            </span>{" "}
            job{check.jobsWithoutRenderTasks === 1 ? "" : "s"} completed in this range with
            NO <span className="font-mono">render_tasks</span> row at all — the inline
            fallback, which runs on the web server whenever no worker heartbeat is fresher
            than {" "}
            <span className="font-mono">workerFreshSeconds</span>. Those jobs burned CPU that
            this page cannot see, so both λ and S are understated.
          </>
        ) : (
          <>
            Every job completed in this range has render-task rows, so no inline-fallback
            runs are missing from λ or S.
          </>
        )}
      </p>
    </section>
  );
}

/** `13` → `13:00–14:00`. */
function hourLabel(hour: number): string {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00–${String(next).padStart(2, "0")}:00`;
}

/** `0.62` → `62%`, and an unstable queue says so rather than showing `Infinity%`. */
function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "over 100%";
  return `${Math.round(value * 100)}%`;
}

/** A wait the model says never ends must not print as a number. */
function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unbounded";
  return formatDuration(seconds);
}

/** `5` is the open-ended top bucket. */
function depthLabel(depth: number): string {
  if (depth === 0) return "0 — empty queue";
  if (depth >= 5) return "5 or more";
  return `${depth} ahead`;
}

function maxOf<T, K extends keyof T>(rows: T[], key: K): number {
  return rows.reduce((best, row) => Math.max(best, Number(row[key]) || 0), 0);
}

function sumOf<T, K extends keyof T>(rows: T[], key: K): number {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}
