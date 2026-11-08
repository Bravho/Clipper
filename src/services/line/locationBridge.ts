/**
 * Location bridge for the LINE AI editing service.
 *
 * The LINE flow asks for a place name and needs coordinates. A coordinates
 * provider (LocBot) pulls queued jobs and posts back lat/lng only.
 *
 * Rules (Tho, 2026-11-07):
 * - Coordinates proceed automatically; no human review.
 * - If LocBot cannot find the place, the shop is asked for more information ONCE,
 *   and the job is checked again. If the second attempt also fails, the
 *   coordinates are left blank and the request continues.
 *
 * Storage: jobs are held in process memory. A server restart drops pending jobs.
 * See the note on `resetLocationJobsForTests` and the restart plan in the shared plan.
 */

export const LOCATION_JOB_TIMEOUT_MS = 10 * 60 * 1000;
export const LOCATION_MAX_ATTEMPTS = 2;

/**
 * queued      waiting for LocBot
 * needs_info  first attempt failed; shop should be asked for the place once more
 * ok          coordinates saved (final)
 * failed      second attempt failed; coordinates left blank (final)
 * timeout     no answer within the time limit (treated like a failed attempt)
 */
export type LocationJobStatus = 'queued' | 'needs_info' | 'ok' | 'failed' | 'timeout';

export interface LocationJob {
  jobId: string;
  placeName: string;
  status: LocationJobStatus;
  attempts: number;
  createdAt: number;
  lat: number | null;
  lng: number | null;
}

export interface LocationResult {
  status: 'ok' | 'not_found' | 'error';
  lat?: number;
  lng?: number;
}

const jobs = new Map<string, LocationJob>();

function expire(job: LocationJob, now: number): LocationJob {
  if (job.status === 'queued' && now - job.createdAt > LOCATION_JOB_TIMEOUT_MS) {
    job.status = job.attempts < LOCATION_MAX_ATTEMPTS ? 'needs_info' : 'failed';
  }
  return job;
}

/**
 * Explicit place marker in a brief, e.g. a line "สถานที่: Pho 54 ย่านอารีย์".
 * Free-text mentions are not detected here; the bot asks for the place instead.
 */
export function extractPlaceFromBrief(text: string): string | null {
  const match = text.match(/^\s*(?:สถานที่|ชื่อสถานที่|place)\s*[:：]\s*(.+)$/im);
  const place = match?.[1]?.trim().slice(0, 150);
  return place ? place : null;
}

export function createLocationJob(jobId: string, placeName: string, now: number): LocationJob {
  const job: LocationJob = { jobId, placeName: placeName.trim(), status: 'queued', attempts: 1, createdAt: now, lat: null, lng: null };
  jobs.set(jobId, job);
  return job;
}

export function getLocationJob(jobId: string, now: number): LocationJob | null {
  const job = jobs.get(jobId);
  return job ? expire(job, now) : null;
}

/** Jobs still waiting for coordinates (not expired). */
export function listQueuedLocationJobs(now: number): LocationJob[] {
  return [...jobs.values()].map(job => expire(job, now)).filter(job => job.status === 'queued');
}

/**
 * Jobs ahead of this one in the location queue (0 = next). Used for the
 * "xx ahead of you" message. Only counts LocBot's queue, not phone-render queues.
 */
export function locationQueuePosition(jobId: string, now: number): number | null {
  const job = getLocationJob(jobId, now);
  if (!job || job.status !== 'queued') return null;
  return listQueuedLocationJobs(now).filter(other => other.createdAt < job.createdAt).length;
}

export type SubmitOutcome =
  | { ok: true; job: LocationJob; duplicate: boolean }
  | { ok: false; error: 'unknown_job' | 'expired' | 'invalid_result' };

/**
 * Record a provider reply. A failed first attempt moves to `needs_info` (the shop
 * is asked once); a failed second attempt becomes `failed`. Repeats are duplicates.
 */
export function submitLocationResult(jobId: string, result: LocationResult, now: number): SubmitOutcome {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: 'unknown_job' };
  expire(job, now);
  if (job.status === 'timeout') return { ok: false, error: 'expired' };
  if (job.status !== 'queued') return { ok: true, job, duplicate: true };

  if (result.status === 'ok') {
    const { lat, lng } = result;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { ok: false, error: 'invalid_result' };
    }
    job.lat = Number(lat.toFixed(6));
    job.lng = Number(lng.toFixed(6));
    job.status = 'ok';
  } else {
    job.status = job.attempts < LOCATION_MAX_ATTEMPTS ? 'needs_info' : 'failed';
  }
  return { ok: true, job, duplicate: false };
}

export type RetryOutcome =
  | { ok: true; job: LocationJob }
  | { ok: false; error: 'unknown_job' | 'not_waiting_for_info' | 'attempts_exhausted' };

/**
 * Shop gave a better place name after a failed first attempt: queue the second and
 * last attempt. Only allowed once, and only while the job is `needs_info`.
 */
export function retryLocationJob(jobId: string, placeName: string, now: number): RetryOutcome {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, error: 'unknown_job' };
  if (job.status !== 'needs_info') return { ok: false, error: 'not_waiting_for_info' };
  if (job.attempts >= LOCATION_MAX_ATTEMPTS) return { ok: false, error: 'attempts_exhausted' };
  const next = placeName.trim().slice(0, 150);
  if (!next) return { ok: false, error: 'not_waiting_for_info' };
  job.placeName = next;
  job.attempts += 1;
  job.status = 'queued';
  job.createdAt = now;
  return { ok: true, job };
}

/** Test helper: clears the in-memory store. */
export function resetLocationJobsForTests(): void {
  jobs.clear();
}
