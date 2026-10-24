import { pool } from "@/lib/db";
import { tableExists } from "@/lib/db/tableExists";
import { RequestStatus } from "@/domain/enums/RequestStatus";
import { VideoGenerationStep as S } from "@/domain/enums/VideoGenerationStep";
import type {
  VideoGenerationJob,
  VideoGenerationStepHistoryEntry,
} from "@/domain/models/VideoGenerationJob";

/**
 * Admin: how far each request got in the studio, read ONLY from data the
 * pipeline already writes (no schema change, no writes — every query below is a
 * SELECT).
 *
 * Where each step comes from:
 *
 *   brief / submitted      clip_requests.created_at / submitted_at (+ status)
 *   storyboarded           video_generation_jobs.storyboard, step history
 *                          `awaiting_content_approval`
 *   storyboard approved    jobs.content_approved_by, history `generating_voice`
 *   voiced                 jobs.processed_voice_asset_id, history
 *                          `awaiting_voice_approval`
 *   script & voice ok      jobs.voice_approved_by, history scene-design steps
 *   render started         jobs.approved_scene_plan (music/template/text style
 *                          are chosen with it), history render steps
 *   rendered (main video)  jobs.captioned_export_*_asset_id, history
 *                          `awaiting_overlay_approval`
 *   framed for channels    more than one captioned export, history
 *                          `generating_additional_ratios`
 *   finished               history `awaiting_distribution_review`/`complete`,
 *                          or clip_requests.status = delivered
 *   downloaded             studio_events action `video_downloaded` (sent by
 *                          the phone; only exists since migration 041 — the
 *                          download route itself records nothing)
 *   sent to Channel Mgmt   management_content_items.source_generation_id
 *   published              management_publication_targets.status = published,
 *                          or a studio publishing draft with status "posted"
 *
 * Step history (video_generation_step_history) is append-only, so the FIRST
 * time a step was entered is its timestamp. A job retried from scratch keeps
 * its earlier rows; that is fine for "latest step reached".
 */

interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface JourneyFacts {
  status: RequestStatus;
  createdAt: Date;
  submittedAt: Date | null;
  hasJob: boolean;
  jobCreatedAt: Date | null;
  currentStep: string | null;
  failedAtStep: string | null;
  /** First time each pipeline step was entered (step history). */
  stepFirstAt: Partial<Record<string, Date>>;
  hasStoryboard: boolean;
  contentApproved: boolean;
  hasVoice: boolean;
  voiceApproved: boolean;
  productionStarted: boolean;
  /** Ratios that have a finished, captioned video. */
  captionedRatios: string[];
  downloadedAt: Date | null;
  transferredAt: Date | null;
  publishedAt: Date | null;
  /** A channel post made straight from the studio's review step (jobs.publishing_drafts). */
  postedFromStudio: boolean;
}

export type JourneyStepKey =
  | "brief"
  | "submitted"
  | "storyboarded"
  | "storyboard_approved"
  | "voiced"
  | "voice_approved"
  | "render_started"
  | "rendered"
  | "framed"
  | "finished"
  | "downloaded"
  | "transferred"
  | "published";

interface StepRule {
  key: JourneyStepKey;
  label: string;
  reached: (f: JourneyFacts) => boolean;
  at: (f: JourneyFacts) => Date | null;
}

function firstOf(f: JourneyFacts, steps: string[]): Date | null {
  const times = steps
    .map((step) => f.stepFirstAt[step])
    .filter((d): d is Date => d instanceof Date);
  if (times.length === 0) return null;
  return new Date(Math.min(...times.map((d) => d.getTime())));
}

const RENDER_STEPS = [
  S.GeneratingBaseVideo,
  S.AwaitingVideoApproval,
  S.MergingScenes,
  S.GeneratingAnimations,
  S.ComposingFinalVideo,
  S.GeneratingOverlay,
];
const FINISHED_STEPS = [S.AwaitingDistributionReview, S.Publishing, S.Complete];

/** The studio journey, in order. The latest reached rule is the request's step. */
export const JOURNEY_STEPS: StepRule[] = [
  { key: "brief", label: "Brief saved", reached: () => true, at: (f) => f.createdAt },
  {
    key: "submitted",
    label: "Submitted",
    reached: (f) => f.status !== RequestStatus.Draft || f.hasJob,
    at: (f) => f.submittedAt ?? f.jobCreatedAt,
  },
  {
    key: "storyboarded",
    label: "Storyboarded",
    reached: (f) => f.hasStoryboard || !!firstOf(f, [S.AwaitingContentApproval]),
    at: (f) => firstOf(f, [S.AwaitingContentApproval]),
  },
  {
    key: "storyboard_approved",
    label: "Storyboard approved",
    reached: (f) => f.contentApproved || !!firstOf(f, [S.GeneratingVoice]),
    at: (f) => firstOf(f, [S.GeneratingVoice]),
  },
  {
    key: "voiced",
    label: "Voiced",
    reached: (f) => f.hasVoice || !!firstOf(f, [S.AwaitingVoiceApproval]),
    at: (f) => firstOf(f, [S.AwaitingVoiceApproval]),
  },
  {
    key: "voice_approved",
    label: "Script & voice approved",
    reached: (f) =>
      f.voiceApproved ||
      !!firstOf(f, [S.GeneratingSceneDesign, S.AwaitingSceneDesignApproval]),
    at: (f) => firstOf(f, [S.GeneratingSceneDesign, S.AwaitingSceneDesignApproval]),
  },
  {
    key: "render_started",
    label: "Sound & look chosen, rendering",
    reached: (f) => f.productionStarted || !!firstOf(f, RENDER_STEPS),
    at: (f) => firstOf(f, RENDER_STEPS),
  },
  {
    key: "rendered",
    label: "Rendered (main video)",
    reached: (f) => f.captionedRatios.length > 0 || !!firstOf(f, [S.AwaitingOverlayApproval]),
    at: (f) => firstOf(f, [S.AwaitingOverlayApproval]),
  },
  {
    key: "framed",
    label: "Framed for other channels",
    reached: (f) =>
      f.captionedRatios.length > 1 || !!firstOf(f, [S.GeneratingAdditionalRatios]),
    at: (f) => firstOf(f, [S.GeneratingAdditionalRatios]),
  },
  {
    key: "finished",
    label: "Finished",
    reached: (f) => f.status === RequestStatus.Delivered || !!firstOf(f, FINISHED_STEPS),
    at: (f) => firstOf(f, FINISHED_STEPS),
  },
  {
    key: "downloaded",
    label: "Downloaded",
    reached: (f) => !!f.downloadedAt,
    at: (f) => f.downloadedAt,
  },
  {
    key: "transferred",
    label: "Sent to Channel Management",
    reached: (f) => !!f.transferredAt,
    at: (f) => f.transferredAt,
  },
  {
    key: "published",
    label: "Published",
    reached: (f) => !!f.publishedAt || f.postedFromStudio,
    at: (f) => f.publishedAt ?? firstOf(f, [S.Publishing]),
  },
];

export const JOURNEY_STEP_KEYS = JOURNEY_STEPS.map((rule) => rule.key);

export function journeyStepLabel(key: string): string {
  return JOURNEY_STEPS.find((rule) => rule.key === key)?.label ?? key;
}

export function journeyStepRank(key: string): number {
  return JOURNEY_STEP_KEYS.indexOf(key as JourneyStepKey);
}

export interface LatestStep {
  key: JourneyStepKey;
  label: string;
  rank: number;
  /** When that step was reached, when the data says so. */
  at: Date | null;
  /** The pipeline stopped with an error; which step failed. */
  failed: boolean;
  failedAtStep: string | null;
}

/** The furthest step the request reached, from the facts alone. */
export function deriveLatestStep(f: JourneyFacts): LatestStep {
  let rank = 0;
  JOURNEY_STEPS.forEach((rule, index) => {
    if (rule.reached(f)) rank = index;
  });
  const rule = JOURNEY_STEPS[rank];
  return {
    key: rule.key,
    label: rule.label,
    rank,
    at: rule.at(f),
    failed: f.currentStep === S.Failed,
    failedAtStep: f.currentStep === S.Failed ? f.failedAtStep : null,
  };
}

/** Every step with whether (and when) it was reached — for the detail timeline. */
export function journeySteps(f: JourneyFacts): {
  key: JourneyStepKey;
  label: string;
  reached: boolean;
  at: Date | null;
}[] {
  return JOURNEY_STEPS.map((rule) => ({
    key: rule.key,
    label: rule.label,
    reached: rule.reached(f),
    at: rule.reached(f) ? rule.at(f) : null,
  }));
}

const CAPTIONED_FIELDS: [string, keyof VideoGenerationJob][] = [
  ["9:16", "captionedExport_9_16_assetId"],
  ["16:9", "captionedExport_16_9_assetId"],
  ["1:1", "captionedExport_1_1_assetId"],
  ["4:5", "captionedExport_4_5_assetId"],
];

/** The captioned (finished) videos of a job, one per ratio. */
export function captionedOutputs(job: VideoGenerationJob | null): { ratio: string; assetId: string }[] {
  if (!job) return [];
  return CAPTIONED_FIELDS.flatMap(([ratio, field]) => {
    const assetId = job[field];
    return typeof assetId === "string" && assetId ? [{ ratio, assetId }] : [];
  });
}

/** Facts for one request from repository objects (the detail page). */
export function factsFromJob(input: {
  request: { status: RequestStatus; createdAt: Date; submittedAt: Date | null };
  job: VideoGenerationJob | null;
  history: VideoGenerationStepHistoryEntry[];
  downloadedAt?: Date | null;
  transferredAt?: Date | null;
  publishedAt?: Date | null;
}): JourneyFacts {
  const { request, job, history } = input;
  const stepFirstAt: Partial<Record<string, Date>> = {};
  for (const entry of history) {
    const at = new Date(entry.createdAt);
    const seen = stepFirstAt[entry.step];
    if (!seen || at < seen) stepFirstAt[entry.step] = at;
  }
  return {
    status: request.status,
    createdAt: request.createdAt,
    submittedAt: request.submittedAt,
    hasJob: !!job,
    jobCreatedAt: job?.createdAt ?? null,
    currentStep: job?.currentStep ?? null,
    failedAtStep: job?.failedAtStep ?? null,
    stepFirstAt,
    hasStoryboard: !!job?.storyboard,
    contentApproved: !!job?.contentApprovedBy,
    hasVoice: !!job?.processedVoiceAssetId,
    voiceApproved: !!job?.voiceApprovedBy,
    productionStarted: !!job?.approvedScenePlan,
    captionedRatios: captionedOutputs(job).map((o) => o.ratio),
    downloadedAt: input.downloadedAt ?? null,
    transferredAt: input.transferredAt ?? null,
    publishedAt: input.publishedAt ?? null,
    postedFromStudio: (job?.publishingDrafts ?? []).some((d) => d?.status === "posted"),
  };
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Read-only queries ───────────────────────────────────────────────────────

const JOBS_SQL = `
  SELECT DISTINCT ON (j.request_id)
         j.request_id::text AS request_id, j.id::text AS job_id,
         j.current_step, j.failed_at_step, j.created_at,
         (j.storyboard IS NOT NULL AND j.storyboard <> '') AS has_storyboard,
         (j.content_approved_by IS NOT NULL)               AS content_approved,
         (j.processed_voice_asset_id IS NOT NULL)          AS has_voice,
         (j.voice_approved_by IS NOT NULL)                 AS voice_approved,
         (j.approved_scene_plan IS NOT NULL)               AS production_started,
         (COALESCE(j.publishing_drafts::text, '') ~ 'status\\\\?"\\s*:\\s*\\\\?"posted') AS posted_from_studio,
         j.captioned_export_9_16_asset_id, j.captioned_export_16_9_asset_id,
         j.captioned_export_1_1_asset_id,  j.captioned_export_4_5_asset_id
    FROM video_generation_jobs j
   WHERE j.request_id::text = ANY($1::text[])
   ORDER BY j.request_id, j.created_at DESC`;

const HISTORY_SQL = `
  SELECT h.job_id::text AS job_id, h.step, MIN(h.created_at) AS first_at
    FROM video_generation_step_history h
   WHERE h.job_id::text = ANY($1::text[])
   GROUP BY 1, 2`;

const DOWNLOADS_SQL = `
  SELECT se.request_id, MAX(se.occurred_at) AS last_at, COUNT(*)::int AS n
    FROM studio_events se
   WHERE se.request_id = ANY($1::text[]) AND se.action = 'video_downloaded'
   GROUP BY 1`;

const TRANSFERS_SQL = `
  SELECT ci.source_generation_id::text AS request_id,
         MIN(COALESCE(ci.transferred_at, ci.created_at)) AS first_at
    FROM management_content_items ci
   WHERE ci.source_generation_id::text = ANY($1::text[])
   GROUP BY 1`;

const PUBLISHED_SQL = `
  SELECT ci.source_generation_id::text AS request_id,
         MIN(COALESCE(t.published_at, t.updated_at)) AS first_at
    FROM management_publication_targets t
    JOIN management_publications p  ON p.id = t.publication_id
    JOIN management_content_items ci ON ci.id = p.management_content_id
   WHERE t.status = 'published'
     AND ci.source_generation_id::text = ANY($1::text[])
   GROUP BY 1`;

const STUDIO_EVENTS_FOR_REQUEST_SQL = `
  SELECT se.action, se.step, se.detail, se.surface, se.occurred_at
    FROM studio_events se
   WHERE se.request_id = $1 AND se.kind = 'action'
   ORDER BY se.occurred_at ASC
   LIMIT 500`;

const CM_ITEMS_FOR_REQUEST_SQL = `
  SELECT ci.id::text AS id, ci.title, ci.status, ci.source_asset_id,
         ci.transferred_at, ci.created_at, ci.removed_at
    FROM management_content_items ci
   WHERE ci.source_generation_id::text = $1
   ORDER BY ci.created_at ASC`;

const CM_TARGETS_FOR_REQUEST_SQL = `
  SELECT ci.id::text AS content_id, t.platform, t.status, t.published_at,
         t.published_url, t.error_message, t.scheduled_at, t.created_at
    FROM management_publication_targets t
    JOIN management_publications p  ON p.id = t.publication_id
    JOIN management_content_items ci ON ci.id = p.management_content_id
   WHERE ci.source_generation_id::text = $1
   ORDER BY t.created_at ASC`;

export interface StudioActionRow {
  action: string;
  step: string | null;
  detail: Record<string, unknown> | null;
  surface: string | null;
  at: Date;
}

export interface ChannelItemRow {
  id: string;
  title: string;
  status: string;
  sourceAssetId: string | null;
  transferredAt: Date | null;
  removedAt: Date | null;
  targets: {
    platform: string;
    status: string;
    publishedAt: Date | null;
    publishedUrl: string | null;
    error: string | null;
    scheduledAt: Date | null;
  }[];
}

export interface RequestJourneyExtras {
  /** False when studio_events (migration 041) is not in this database. */
  studioEventsAvailable: boolean;
  studioActions: StudioActionRow[];
  channelItems: ChannelItemRow[];
}

export interface RequestIdentity {
  id: string;
  status: RequestStatus;
  createdAt: Date;
  submittedAt: Date | null;
}

export class AdminRequestJourneyService {
  constructor(private db: QueryableDb = pool) {}

  /**
   * Latest step for many requests at once (the All Requests list): five
   * grouped SELECTs, however many requests there are.
   */
  async latestStepsFor(requests: RequestIdentity[]): Promise<Map<string, LatestStep>> {
    const result = new Map<string, LatestStep>();
    if (requests.length === 0) return result;
    const ids = requests.map((r) => String(r.id));

    const [hasEvents, hasCm] = await Promise.all([
      tableExists("studio_events", this.db),
      tableExists("management_publication_targets", this.db),
    ]);

    const jobs = await this.db.query(JOBS_SQL, [ids]);
    const jobByRequest = new Map(jobs.rows.map((row) => [String(row.request_id), row]));
    const jobIds = jobs.rows.map((row) => String(row.job_id));

    const [history, downloads, transfers, published] = await Promise.all([
      jobIds.length ? this.db.query(HISTORY_SQL, [jobIds]) : Promise.resolve({ rows: [] }),
      hasEvents ? this.db.query(DOWNLOADS_SQL, [ids]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
      hasCm ? this.db.query(TRANSFERS_SQL, [ids]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
      hasCm ? this.db.query(PUBLISHED_SQL, [ids]).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
    ]);

    const historyByJob = new Map<string, Partial<Record<string, Date>>>();
    for (const row of history.rows) {
      const jobId = String(row.job_id);
      const at = asDate(row.first_at);
      if (!at) continue;
      const map = historyByJob.get(jobId) ?? {};
      map[String(row.step)] = at;
      historyByJob.set(jobId, map);
    }
    const byRequest = (rows: Record<string, unknown>[], field: string) =>
      new Map(rows.map((row) => [String(row.request_id), asDate(row[field])]));
    const downloadAt = byRequest(downloads.rows, "last_at");
    const transferAt = byRequest(transfers.rows, "first_at");
    const publishAt = byRequest(published.rows, "first_at");

    for (const request of requests) {
      const id = String(request.id);
      const job = jobByRequest.get(id);
      const captionedRatios = job
        ? ([
            ["9:16", job.captioned_export_9_16_asset_id],
            ["16:9", job.captioned_export_16_9_asset_id],
            ["1:1", job.captioned_export_1_1_asset_id],
            ["4:5", job.captioned_export_4_5_asset_id],
          ] as [string, unknown][])
            .filter(([, assetId]) => typeof assetId === "string" && assetId)
            .map(([ratio]) => ratio)
        : [];
      const facts: JourneyFacts = {
        status: request.status,
        createdAt: request.createdAt,
        submittedAt: request.submittedAt,
        hasJob: !!job,
        jobCreatedAt: job ? asDate(job.created_at) : null,
        currentStep: job ? (job.current_step as string | null) ?? null : null,
        failedAtStep: job ? (job.failed_at_step as string | null) ?? null : null,
        stepFirstAt: job ? historyByJob.get(String(job.job_id)) ?? {} : {},
        hasStoryboard: Boolean(job?.has_storyboard),
        contentApproved: Boolean(job?.content_approved),
        hasVoice: Boolean(job?.has_voice),
        voiceApproved: Boolean(job?.voice_approved),
        productionStarted: Boolean(job?.production_started),
        captionedRatios,
        downloadedAt: downloadAt.get(id) ?? null,
        transferredAt: transferAt.get(id) ?? null,
        publishedAt: publishAt.get(id) ?? null,
        postedFromStudio: Boolean(job?.posted_from_studio),
      };
      result.set(id, deriveLatestStep(facts));
    }
    return result;
  }

  /** The studio clicks and the Channel Management records of one request. */
  async extrasFor(requestId: string): Promise<RequestJourneyExtras> {
    const [hasEvents, hasCm] = await Promise.all([
      tableExists("studio_events", this.db),
      tableExists("management_publication_targets", this.db),
    ]);
    const [events, items, targets] = await Promise.all([
      hasEvents
        ? this.db.query(STUDIO_EVENTS_FOR_REQUEST_SQL, [requestId]).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] }),
      hasCm
        ? this.db.query(CM_ITEMS_FOR_REQUEST_SQL, [requestId]).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] }),
      hasCm
        ? this.db.query(CM_TARGETS_FOR_REQUEST_SQL, [requestId]).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] }),
    ]);

    const studioActions: StudioActionRow[] = events.rows.flatMap((row) => {
      const at = asDate(row.occurred_at);
      if (!at || !row.action) return [];
      return [
        {
          action: String(row.action),
          step: row.step ? String(row.step) : null,
          detail:
            row.detail && typeof row.detail === "object"
              ? (row.detail as Record<string, unknown>)
              : null,
          surface: row.surface ? String(row.surface) : null,
          at,
        },
      ];
    });

    const channelItems: ChannelItemRow[] = items.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      sourceAssetId: row.source_asset_id ? String(row.source_asset_id) : null,
      transferredAt: asDate(row.transferred_at) ?? asDate(row.created_at),
      removedAt: asDate(row.removed_at),
      targets: targets.rows
        .filter((t) => String(t.content_id) === String(row.id))
        .map((t) => ({
          platform: String(t.platform ?? ""),
          status: String(t.status ?? ""),
          publishedAt: asDate(t.published_at),
          publishedUrl: t.published_url ? String(t.published_url) : null,
          error: t.error_message ? String(t.error_message) : null,
          scheduledAt: asDate(t.scheduled_at),
        })),
    }));

    return { studioEventsAvailable: hasEvents, studioActions, channelItems };
  }
}

export const adminRequestJourneyService = new AdminRequestJourneyService();
