import { pool } from "@/lib/db";
import { REPORTING_TIMEZONE } from "@/features/admin/dateRange";
import { RENDER_QUEUE } from "@/config/renderQueue";
import { tableExists } from "@/lib/db/tableExists";

/**
 * CPU sizing for the render worker.
 *
 * WHAT CONSUMES CPU HERE. Not the web server — it orchestrates and waits on
 * network-bound AI APIs. The compute is the Mac Mini worker running FFmpeg and
 * Remotion: Addendum B of `docs/storage-lifecycle-design.md` measures an M4/16GB
 * at 1–2 concurrent Remotion renders (each spawns Chromium at 1–3 GB) and
 * ~2–4 minutes of render+encode per job, against 1–55 s of transfer. Compute
 * dominates transfer by an order of magnitude, so the sizing question is
 * "how many concurrent renders", not "how much bandwidth".
 *
 * THE MODEL. A multi-server queue (M/M/c) over measured inputs:
 *
 *     λ  peak-hour job arrival rate     measured from render_tasks arrivals
 *     S  service demand per job         measured from SUM(render_tasks.duration_ms)
 *     c  concurrency × worker count     config × measured
 *     ρ  = λ·S / c                      utilisation; past ~0.8 waits explode
 *     Wq = Erlang-C(c, λ, S)            expected queue wait
 *
 * Every one of those inputs is reported as its own measured number, because a
 * model is only as honest as the inputs a reader can check. Anything this file
 * computes rather than measures is named a projection in its type and on the
 * page — this surface will be used to argue for hardware, and an admin has to be
 * able to tell a measurement from an extrapolation at a glance.
 *
 * THE MODEL'S OWN LIMITS. M/M/c assumes Poisson arrivals, exponential service
 * and identical servers. Render service times are closer to 2–4 minutes plus a
 * tail than to exponential, so Erlang-C OVERSTATES the wait somewhat (it assumes
 * more service-time variability than really exists) — a conservative direction
 * for a sizing decision, but a bias, not neutrality. It also cannot see thermal
 * throttling or memory pressure on a Mac Mini. That is why the page also carries
 * the purely empirical utilisation-vs-latency curve, which needs no queueing
 * assumption at all, and names the load test as the thing that would settle it.
 *
 * The pool is constructor-injected (the `ManagementAuditService` /
 * `GateEventService` pattern) so the tests run without a socket.
 */

import type { MetricsRange } from "@/services/admin/AdminApprovalMetricsService";

/**
 * Range shape and duration formatting are shared with the approvals service
 * rather than re-declared here. The two analytics pages are read side by side,
 * and a wait printed `2m 30s` on one and `150s` on the other reads as two
 * different measurements; re-exporting also means the capacity page has a single
 * import source.
 */
export { formatDuration } from "@/services/admin/AdminApprovalMetricsService";
export type { MetricsRange };

/** Minimal `pg` pool surface, so a stub can stand in for a real Pool. */
interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ── Queueing theory ─────────────────────────────────────────────────────────

/**
 * Erlang B — blocking probability for `c` servers under offered load `a`.
 *
 * Computed with the standard recursion
 *
 *     B(0, a) = 1
 *     B(n, a) = a·B(n−1, a) / (n + a·B(n−1, a))
 *
 * rather than from the closed form `(aⁿ/n!) / Σ(aᵏ/k!)`. The closed form
 * overflows on both ends — `a^n` and `n!` blow past Float64 for perfectly
 * ordinary inputs — while the recursion only ever multiplies and divides numbers
 * of the same order, so it is stable for every `c` this page will ever ask
 * about. It is also exact for the small `c` that matter here: `B(2, 1) = 0.2`
 * comes out as 0.2, not 0.19999999.
 */
export function erlangB(servers: number, offeredLoad: number): number {
  const c = Math.floor(servers);
  if (c < 1 || !Number.isFinite(offeredLoad) || offeredLoad < 0) return 1;
  let b = 1;
  for (let n = 1; n <= c; n += 1) {
    b = (offeredLoad * b) / (n + offeredLoad * b);
  }
  return b;
}

/**
 * Erlang C — the probability that an arriving job has to WAIT.
 *
 * Derived from Erlang B for the same numerical-stability reason:
 *
 *     C(c, a) = B(c, a) / (1 − ρ·(1 − B(c, a))),  ρ = a/c
 *
 * `a ≥ c` means the queue is unstable — arrivals outrun the servers and the
 * backlog grows without bound — so the honest answer is 1 (everything waits),
 * and the wait itself is infinite. Returning a finite number there would be the
 * single most dangerous thing this file could do: it is precisely the regime the
 * page exists to warn about.
 */
export function erlangC(servers: number, offeredLoad: number): number {
  const c = Math.floor(servers);
  if (c < 1) return 1;
  if (!Number.isFinite(offeredLoad) || offeredLoad <= 0) return 0;
  if (offeredLoad >= c) return 1;
  const b = erlangB(c, offeredLoad);
  const rho = offeredLoad / c;
  return b / (1 - rho * (1 - b));
}

/**
 * Mean queue wait, in the same time unit as `serviceTime`.
 *
 *     Wq = C(c, a) · S / (c − a)
 */
export function erlangCMeanWait(
  servers: number,
  offeredLoad: number,
  serviceTime: number
): number {
  const c = Math.floor(servers);
  if (c < 1 || offeredLoad >= c) return Number.POSITIVE_INFINITY;
  if (offeredLoad <= 0 || serviceTime <= 0) return 0;
  return (erlangC(c, offeredLoad) * serviceTime) / (c - offeredLoad);
}

/**
 * The wait that `percentile` of jobs come in under, same unit as `serviceTime`.
 *
 * In M/M/c the waiting time is exponential above an atom at zero:
 *
 *     P(W > t) = C(c, a) · exp(−(c − a)·t / S)
 *
 * so the p-th percentile inverts to `t = S/(c−a) · ln(C / (1−p))`. When
 * `C ≤ 1−p` more than `p` of jobs never queue at all and the percentile is
 * genuinely ZERO — that is not a degenerate case to guard against, it is the
 * answer an under-loaded worker should give.
 */
export function erlangCWaitPercentile(
  servers: number,
  offeredLoad: number,
  serviceTime: number,
  percentile: number
): number {
  const c = Math.floor(servers);
  if (c < 1 || offeredLoad >= c) return Number.POSITIVE_INFINITY;
  if (offeredLoad <= 0 || serviceTime <= 0) return 0;
  const tail = 1 - percentile;
  const probabilityOfWaiting = erlangC(c, offeredLoad);
  if (probabilityOfWaiting <= tail) return 0;
  return (serviceTime / (c - offeredLoad)) * Math.log(probabilityOfWaiting / tail);
}

// ── Measured inputs ─────────────────────────────────────────────────────────

/** Peak-hour arrival, and the slot it was measured in. */
export interface ArrivalProfile {
  /** Jobs per hour in the busiest weekday-hour of the range. */
  peakPerHour: number;
  /** Jobs per hour averaged across every hour of the range. */
  meanPerHour: number;
  /** 0 = Sunday, Bangkok. Null when nothing was enqueued. */
  peakDayOfWeek: number | null;
  peakHour: number | null;
  /** How many times that weekday-hour occurred in the range. */
  peakOccurrences: number;
  /** Jobs that arrived across all occurrences of the peak slot. */
  peakJobs: number;
  /** Distinct jobs that entered the render queue in the range. */
  totalJobs: number;
}

/** Service demand per job, from the worker's own duration records. */
export interface ServiceProfile {
  /** Mean CPU-seconds per job — `S`. */
  meanSecondsPerJob: number;
  medianSecondsPerJob: number;
  p90SecondsPerJob: number;
  /** Jobs with at least one finished render task in the range. */
  jobs: number;
  /** Finished render tasks those jobs are made of. */
  tasks: number;
}

/** One `?date=`-keyed point of worker load. */
export interface WorkerLoadPoint {
  /** `YYYY-MM-DD` in Bangkok. */
  date: string;
  avgCpuPercent: number;
  peakCpuPercent: number;
  avgLoad1m: number;
  avgQueueDepth: number;
  peakQueueDepth: number;
  avgActiveTasks: number;
  samples: number;
}

/** One `?date=`-keyed point of how long tasks waited before starting. */
export interface QueueWaitPoint {
  date: string;
  tasks: number;
  medianWaitSeconds: number;
  p90WaitSeconds: number;
}

/**
 * The empirical curve: how long a task waited, against how deep the queue was
 * at the moment it was enqueued.
 */
export interface QueueDepthBucket {
  /** Queue depth at enqueue. `5` is the open-ended "5 or more" bucket. */
  depth: number;
  tasks: number;
  medianWaitSeconds: number;
  p90WaitSeconds: number;
  meanWaitSeconds: number;
}

/** Little's Law, with each term sourced separately so they can disagree. */
export interface LittlesLawCheck {
  /** λ — finished tasks per hour across the window. */
  arrivalsPerHour: number;
  /** W — mean time in system (enqueue → finish), seconds. */
  meanTimeInSystemSeconds: number;
  /** L predicted by λ·W. */
  predictedInSystem: number;
  /** L observed independently, from sampled `queue_depth`. Null with no samples. */
  observedInSystem: number | null;
  observedSamples: number;
  /** |predicted − observed| / observed. Null when there is nothing to compare. */
  relativeGap: number | null;
  /** Completed jobs in the range with NO render_tasks row at all. */
  jobsWithoutRenderTasks: number;
  tasksMeasured: number;
}

/** One row of the "what if we ran at concurrency N" table. */
export interface ConcurrencyScenario {
  /** Total concurrent render slots across all workers — `c`. */
  servers: number;
  /** `a = λ·S`, in Erlangs. */
  offeredLoad: number;
  utilisation: number;
  probabilityOfWaiting: number;
  /** Seconds. `Infinity` when the queue is unstable at this concurrency. */
  meanWaitSeconds: number;
  p90WaitSeconds: number;
  /** Videos/day this many slots sustain while holding ρ at the safe ceiling. */
  maxSustainablePerDay: number;
  stable: boolean;
  meetsTarget: boolean;
}

export interface CapacityModel {
  arrivals: ArrivalProfile;
  service: ServiceProfile;
  /** Distinct workers that claimed a task in the range. Measured. */
  workerCount: number;
  /** `RENDER_CONCURRENCY`. Config, not a measurement. */
  concurrencyPerWorker: number;
  /** `c` as things stand today. */
  currentServers: number;
  /** `a = λ_peak · S`. */
  offeredLoad: number;
  /** `ρ = a / c` at the current concurrency. */
  utilisation: number;
  /** Target the recommendation is solved against, in minutes. */
  targetMinutes: number;
  /** Smallest `c` whose modelled p90 wait clears the target. Null if none does. */
  recommendedServers: number | null;
  scenarios: ConcurrencyScenario[];
}

export interface CapacityReport {
  model: CapacityModel;
  workerLoad: WorkerLoadPoint[];
  queueWait: QueueWaitPoint[];
  depthBuckets: QueueDepthBucket[];
  littlesLaw: LittlesLawCheck;
  /** No `render_worker_samples` rows in the range — the worker predates sampling. */
  samplingUnavailable: boolean;
}

/** Default p90 queue-wait target the recommendation solves for. */
export const DEFAULT_TARGET_MINUTES = 15;

/**
 * The utilisation the "max sustainable volume" column holds to.
 *
 * Not 1.0. At ρ = 1 the queue is by definition unstable, and the wait curve is
 * already near-vertical well before that — the standard operating ceiling is
 * ~0.8, which is where this page draws the line.
 */
export const SAFE_UTILISATION = 0.8;

/** Concurrencies the scenario table covers. Beyond ~4 the 16 GB box is the limit. */
const SCENARIO_SERVERS = [1, 2, 3, 4];

/** How far the recommendation search will go before giving up. */
const MAX_SEARCH_SERVERS = 16;

/** Deepest queue-depth bucket; everything above it collapses into "5+". */
const MAX_DEPTH_BUCKET = 5;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `null` preserved — "not measured" must not collapse into "measured zero". */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Clamp a `?targetMinutes=` query value to something a model can answer. */
export function parseTargetMinutes(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TARGET_MINUTES;
  return Math.min(24 * 60, Math.max(1, parsed));
}

/**
 * Build the scenario table and the recommendation from measured λ and S.
 *
 * Pure and exported so it can be unit-tested against hand-computed queueing
 * results without a database anywhere near it.
 */
export function buildScenarios(
  lambdaPerHour: number,
  serviceSecondsPerJob: number,
  targetMinutes: number,
  servers: number[] = SCENARIO_SERVERS
): { scenarios: ConcurrencyScenario[]; recommendedServers: number | null } {
  const serviceHours = serviceSecondsPerJob / 3600;
  const offeredLoad = lambdaPerHour * serviceHours;
  const targetSeconds = targetMinutes * 60;

  const scenarioFor = (c: number): ConcurrencyScenario => {
    const stable = offeredLoad < c;
    const p90 = erlangCWaitPercentile(c, offeredLoad, serviceSecondsPerJob, 0.9);
    return {
      servers: c,
      offeredLoad,
      utilisation: c > 0 ? offeredLoad / c : Number.POSITIVE_INFINITY,
      probabilityOfWaiting: erlangC(c, offeredLoad),
      meanWaitSeconds: erlangCMeanWait(c, offeredLoad, serviceSecondsPerJob),
      p90WaitSeconds: p90,
      // Invert ρ = λ·S/c at the safe ceiling: λ_max = ρ_safe·c/S, per day.
      maxSustainablePerDay:
        serviceHours > 0 ? (SAFE_UTILISATION * c * 24) / serviceHours : 0,
      stable,
      meetsTarget: stable && p90 <= targetSeconds,
    };
  };

  let recommended: number | null = null;
  for (let c = 1; c <= MAX_SEARCH_SERVERS; c += 1) {
    if (scenarioFor(c).meetsTarget) {
      recommended = c;
      break;
    }
  }

  return { scenarios: servers.map(scenarioFor), recommendedServers: recommended };
}

export class AdminCapacityService {
  constructor(private db: QueryableDb = pool) {}

  async getReport(
    range: MetricsRange,
    targetMinutes: number = DEFAULT_TARGET_MINUTES
  ): Promise<CapacityReport> {
    const [arrivals, service, workerCount, workerLoad, queueWait, depthBuckets, littlesLaw] =
      await Promise.all([
        this.getArrivalProfile(range),
        this.getServiceProfile(range),
        this.getWorkerCount(range),
        this.getWorkerLoad(range),
        this.getQueueWait(range),
        this.getDepthBuckets(range),
        this.getLittlesLaw(range),
      ]);

    const concurrencyPerWorker = RENDER_QUEUE.concurrency;
    // No worker has claimed anything yet → model the one box the config assumes,
    // rather than dividing by zero and reporting infinite utilisation.
    const currentServers = Math.max(1, workerCount) * concurrencyPerWorker;
    const offeredLoad = arrivals.peakPerHour * (service.meanSecondsPerJob / 3600);

    const { scenarios, recommendedServers } = buildScenarios(
      arrivals.peakPerHour,
      service.meanSecondsPerJob,
      targetMinutes
    );

    return {
      model: {
        arrivals,
        service,
        workerCount,
        concurrencyPerWorker,
        currentServers,
        offeredLoad,
        utilisation: currentServers > 0 ? offeredLoad / currentServers : Number.POSITIVE_INFINITY,
        targetMinutes,
        recommendedServers,
        scenarios,
      },
      workerLoad,
      queueWait,
      depthBuckets,
      littlesLaw,
      samplingUnavailable: workerLoad.length === 0,
    };
  }

  /**
   * λ — measured, twice.
   *
   * The peak-hour rate is what sizes hardware: a box that survives the daily
   * average and drowns every Monday evening is an under-sized box. It is a RATE,
   * so the busiest weekday-hour's job count is divided by the number of times
   * that weekday-hour actually occurred in the range — `generate_series` over
   * the window counts those occurrences exactly, rather than assuming the range
   * is a whole number of weeks.
   *
   * A job is counted once, at `MIN(enqueued_at)`: one video enqueues several
   * heavy steps in sequence, and counting tasks would inflate λ by the number of
   * steps while `S` already sums them.
   */
  async getArrivalProfile(range: MetricsRange): Promise<ArrivalProfile> {
    const { rows } = await this.db.query(
      `WITH slots AS (
         SELECT generate_series($1::timestamptz,
                                $2::timestamptz - INTERVAL '1 hour',
                                INTERVAL '1 hour') AS slot
       ),
       slot_counts AS (
         SELECT EXTRACT(DOW  FROM slot AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS dow,
                EXTRACT(HOUR FROM slot AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS hour,
                COUNT(*)::int AS occurrences
           FROM slots
          GROUP BY 1, 2
       ),
       first_seen AS (
         SELECT job_id, MIN(enqueued_at) AS arrived_at
           FROM render_tasks
          WHERE enqueued_at >= $1
            AND enqueued_at <  $2
          GROUP BY job_id
       ),
       arrivals AS (
         SELECT EXTRACT(DOW  FROM arrived_at AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS dow,
                EXTRACT(HOUR FROM arrived_at AT TIME ZONE '${REPORTING_TIMEZONE}')::int AS hour,
                COUNT(*)::int AS jobs
           FROM first_seen
          GROUP BY 1, 2
       ),
       totals AS (
         SELECT COUNT(*)::int AS total_jobs FROM first_seen
       )
       SELECT a.dow,
              a.hour,
              a.jobs,
              s.occurrences,
              (a.jobs::float8 / NULLIF(s.occurrences, 0)) AS peak_per_hour,
              t.total_jobs,
              (SELECT COUNT(*)::int FROM slots) AS window_hours
         FROM arrivals a
         JOIN slot_counts s ON s.dow = a.dow AND s.hour = a.hour
         CROSS JOIN totals t
        ORDER BY peak_per_hour DESC NULLS LAST, a.jobs DESC
        LIMIT 1`,
      [range.from, range.to]
    );

    const row = rows[0];
    if (!row) {
      return {
        peakPerHour: 0,
        meanPerHour: 0,
        peakDayOfWeek: null,
        peakHour: null,
        peakOccurrences: 0,
        peakJobs: 0,
        totalJobs: 0,
      };
    }

    const windowHours = Math.max(1, num(row.window_hours));
    const totalJobs = num(row.total_jobs);
    return {
      peakPerHour: num(row.peak_per_hour),
      meanPerHour: totalJobs / windowHours,
      peakDayOfWeek: numOrNull(row.dow),
      peakHour: numOrNull(row.hour),
      peakOccurrences: num(row.occurrences),
      peakJobs: num(row.jobs),
      totalJobs,
    };
  }

  /**
   * S — mean service demand per job, in CPU-seconds.
   *
   * Summed per job first, then averaged: a video is several heavy steps (scene
   * segments, merge, animation, compose, overlay, ratios) and the worker's
   * `duration_ms` is per step. Averaging steps would answer "how long is a
   * step", which is not what occupies a render slot for a whole video.
   *
   * Only `state = 'done'` rows count. A failed task burned real CPU, but its
   * duration is the time until it gave up, which is not the service time of a
   * successful render and would bias `S` in an unpredictable direction.
   */
  async getServiceProfile(range: MetricsRange): Promise<ServiceProfile> {
    const { rows } = await this.db.query(
      `WITH per_job AS (
         SELECT job_id,
                SUM(duration_ms)::float8 / 1000.0 AS job_seconds,
                COUNT(*)::int AS task_count
           FROM render_tasks
          WHERE state = 'done'
            AND duration_ms IS NOT NULL
            AND finished_at >= $1
            AND finished_at <  $2
          GROUP BY job_id
       )
       SELECT COUNT(*)::int                                                          AS jobs,
              COALESCE(SUM(task_count), 0)::int                                      AS tasks,
              COALESCE(AVG(job_seconds), 0)::float8                                  AS mean_seconds,
              COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY job_seconds), 0)::float8 AS median_seconds,
              COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY job_seconds), 0)::float8 AS p90_seconds
         FROM per_job`,
      [range.from, range.to]
    );

    const row = rows[0] ?? {};
    return {
      jobs: num(row.jobs),
      tasks: num(row.tasks),
      meanSecondsPerJob: num(row.mean_seconds),
      medianSecondsPerJob: num(row.median_seconds),
      p90SecondsPerJob: num(row.p90_seconds),
    };
  }

  /**
   * How many worker boxes were actually in service.
   *
   * From `claimed_by` on real work rather than from `render_worker_heartbeat`:
   * a heartbeat row proves a process was running, a claim proves it rendered.
   */
  async getWorkerCount(range: MetricsRange): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(DISTINCT claimed_by)::int AS workers
         FROM render_tasks
        WHERE claimed_by IS NOT NULL
          AND claimed_at >= $1
          AND claimed_at <  $2`,
      [range.from, range.to]
    );
    return num(rows[0]?.workers);
  }

  /**
   * Worker load per Bangkok day.
   *
   * Daily rather than per-sample: `render_worker_samples` lands once a minute,
   * so a 30-day range is ~43k points — more than a line chart can say anything
   * with. Both the average and the peak are kept, because a box that averages
   * 40% CPU while hitting 100% for an hour a day is not a box with headroom.
   */
  async getWorkerLoad(range: MetricsRange): Promise<WorkerLoadPoint[]> {
    // Migration 028 may not have reached this database. No samples and no table
    // are the same story for this chart — "nothing has been sampled yet" — and
    // the empty state already says so, so degrade instead of throwing.
    if (!(await tableExists("render_worker_samples", this.db))) return [];

    const { rows } = await this.db.query(
      `SELECT TO_CHAR(sampled_at AT TIME ZONE '${REPORTING_TIMEZONE}', 'YYYY-MM-DD') AS date,
              COALESCE(AVG(cpu_percent), 0)::float8    AS avg_cpu,
              COALESCE(MAX(cpu_percent), 0)::float8    AS peak_cpu,
              COALESCE(AVG(load_avg_1m), 0)::float8    AS avg_load,
              COALESCE(AVG(queue_depth), 0)::float8    AS avg_queue_depth,
              COALESCE(MAX(queue_depth), 0)::int       AS peak_queue_depth,
              COALESCE(AVG(active_tasks), 0)::float8   AS avg_active,
              COUNT(*)::int                            AS samples
         FROM render_worker_samples
        WHERE sampled_at >= $1
          AND sampled_at <  $2
        GROUP BY 1
        ORDER BY 1`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      date: String(row.date ?? ""),
      avgCpuPercent: num(row.avg_cpu),
      peakCpuPercent: num(row.peak_cpu),
      avgLoad1m: num(row.avg_load),
      avgQueueDepth: num(row.avg_queue_depth),
      peakQueueDepth: num(row.peak_queue_depth),
      avgActiveTasks: num(row.avg_active),
      samples: num(row.samples),
    }));
  }

  /**
   * Queue wait per Bangkok day — the latency half of the load/latency pair.
   *
   * Deliberately its OWN series on its OWN chart rather than a second y-axis
   * over the CPU line: percent and seconds share no scale, and overlaying them
   * invites reading a crossing point that means nothing.
   */
  async getQueueWait(range: MetricsRange): Promise<QueueWaitPoint[]> {
    const { rows } = await this.db.query(
      `SELECT TO_CHAR(enqueued_at AT TIME ZONE '${REPORTING_TIMEZONE}', 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS tasks,
              PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (started_at - enqueued_at))
              )::float8 AS median_wait,
              PERCENTILE_CONT(0.9) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (started_at - enqueued_at))
              )::float8 AS p90_wait
         FROM render_tasks
        WHERE started_at IS NOT NULL
          AND enqueued_at >= $1
          AND enqueued_at <  $2
        GROUP BY 1
        ORDER BY 1`,
      [range.from, range.to]
    );

    return rows.map((row) => ({
      date: String(row.date ?? ""),
      tasks: num(row.tasks),
      medianWaitSeconds: num(row.median_wait),
      p90WaitSeconds: num(row.p90_wait),
    }));
  }

  /**
   * The empirical utilisation-vs-latency curve.
   *
   * For every task that actually started, how deep was the line when it joined,
   * and how long did it then wait. The knee of that curve is the capacity
   * ceiling as the system really behaves — no Poisson assumption, no exponential
   * service, no Erlang. Where this and the model disagree, this is right.
   *
   * Depth at enqueue is counted with a correlated subquery over the same table:
   * a task was "in the system" at instant T if it was enqueued at or before T
   * and had not finished by T. `finished_at` is NULL for a task that is still
   * running or was abandoned, so the COALESCE falls back to the keep-alive and
   * then to `updated_at` — otherwise an abandoned claim would be treated as
   * having left the queue the moment it stopped reporting.
   */
  async getDepthBuckets(range: MetricsRange): Promise<QueueDepthBucket[]> {
    const { rows } = await this.db.query(
      `WITH observed AS (
         SELECT EXTRACT(EPOCH FROM (t.started_at - t.enqueued_at))::float8 AS wait_seconds,
                LEAST(
                  (SELECT COUNT(*)
                     FROM render_tasks o
                    WHERE o.id <> t.id
                      AND o.enqueued_at <= t.enqueued_at
                      AND COALESCE(o.finished_at, o.heartbeat_at, o.updated_at) > t.enqueued_at),
                  $3::int
                )::int AS depth
           FROM render_tasks t
          WHERE t.started_at IS NOT NULL
            AND t.enqueued_at >= $1
            AND t.enqueued_at <  $2
       )
       SELECT depth,
              COUNT(*)::int AS tasks,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY wait_seconds)::float8 AS median_wait,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY wait_seconds)::float8 AS p90_wait,
              AVG(wait_seconds)::float8 AS mean_wait
         FROM observed
        GROUP BY depth
        ORDER BY depth`,
      [range.from, range.to, MAX_DEPTH_BUCKET]
    );

    return rows.map((row) => ({
      depth: num(row.depth),
      tasks: num(row.tasks),
      medianWaitSeconds: num(row.median_wait),
      p90WaitSeconds: num(row.p90_wait),
      meanWaitSeconds: num(row.mean_wait),
    }));
  }

  /**
   * Little's Law as a data-quality check, not as a result.
   *
   * `L = λ·W` holds for ANY stable queue regardless of distribution, so the two
   * sides only disagree when the data is wrong. λ and W come from
   * `render_tasks`; L comes independently from the sampled `queue_depth` in
   * `render_worker_samples`, which the worker records as the platform-wide count
   * of queued + claimed tasks — that is the number-in-system Little's Law is
   * about, so `active_tasks` must NOT be added to it or claimed tasks are
   * counted twice.
   *
   * The usual reason for a gap is on the λ side: when no worker is fresh the web
   * server runs the step inline and writes NO `render_tasks` row at all, so the
   * measured arrival rate is short by exactly those jobs. That count is reported
   * alongside, because it is the explanation, not a footnote.
   */
  async getLittlesLaw(range: MetricsRange): Promise<LittlesLawCheck> {
    const samplesAvailable = await tableExists("render_worker_samples", this.db);
    const windowHours = Math.max(
      1 / 60,
      (range.to.getTime() - range.from.getTime()) / 3_600_000
    );

    const [flowResult, sampleResult, inlineResult] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*)::int AS tasks,
                COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - enqueued_at))), 0)::float8
                  AS mean_system_seconds
           FROM render_tasks
          WHERE finished_at IS NOT NULL
            AND enqueued_at >= $1
            AND enqueued_at <  $2`,
        [range.from, range.to]
      ),
      samplesAvailable
        ? this.db.query(
            `SELECT COUNT(*)::int AS samples,
                    AVG(queue_depth)::float8 AS observed_in_system
               FROM render_worker_samples
              WHERE sampled_at >= $1
                AND sampled_at <  $2
                AND queue_depth IS NOT NULL`,
            [range.from, range.to]
          )
        : Promise.resolve({ rows: [{ samples: 0, observed_in_system: null }] }),
      this.db.query(
        `SELECT COUNT(*)::int AS jobs
           FROM video_generation_jobs j
          WHERE j.status = 'complete'
            AND j.updated_at >= $1
            AND j.updated_at <  $2
            AND NOT EXISTS (
              SELECT 1 FROM render_tasks r WHERE r.job_id::text = j.id::text
            )`,
        [range.from, range.to]
      ),
    ]);

    const flow = flowResult.rows[0] ?? {};
    const sample = sampleResult.rows[0] ?? {};
    const inline = inlineResult.rows[0] ?? {};

    const tasks = num(flow.tasks);
    const meanTimeInSystemSeconds = num(flow.mean_system_seconds);
    const arrivalsPerHour = tasks / windowHours;
    const predictedInSystem = arrivalsPerHour * (meanTimeInSystemSeconds / 3600);

    const observedSamples = num(sample.samples);
    const observedInSystem = observedSamples > 0 ? numOrNull(sample.observed_in_system) : null;

    return {
      arrivalsPerHour,
      meanTimeInSystemSeconds,
      predictedInSystem,
      observedInSystem,
      observedSamples,
      relativeGap:
        observedInSystem !== null && observedInSystem > 0
          ? Math.abs(predictedInSystem - observedInSystem) / observedInSystem
          : null,
      jobsWithoutRenderTasks: num(inline.jobs),
      tasksMeasured: tasks,
    };
  }
}

export const adminCapacityService = new AdminCapacityService();
