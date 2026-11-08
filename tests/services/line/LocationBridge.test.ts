import {
  LOCATION_JOB_TIMEOUT_MS,
  createLocationJob,
  extractPlaceFromBrief,
  getLocationJob,
  listQueuedLocationJobs,
  locationQueuePosition,
  resetLocationJobsForTests,
  retryLocationJob,
  submitLocationResult,
} from '@/services/line/locationBridge';

describe('LINE location bridge', () => {
  beforeEach(() => resetLocationJobsForTests());

  it('queues a job and lists it until a result arrives', () => {
    createLocationJob('job-1', '  Bangkok, Thailand ', 1000);
    const queued = listQueuedLocationJobs(1000);
    expect(queued).toHaveLength(1);
    expect(queued[0].placeName).toBe('Bangkok, Thailand');

    const out = submitLocationResult('job-1', { status: 'ok', lat: 13.756331, lng: 100.501765 }, 2000);
    expect(out.ok).toBe(true);
    expect(listQueuedLocationJobs(2000)).toHaveLength(0);
    expect(getLocationJob('job-1', 2000)).toMatchObject({ status: 'ok', lat: 13.756331, lng: 100.501765 });
  });

  it('rounds coordinates to 6 decimals and stores only lat/lng', () => {
    createLocationJob('job-2', 'Somewhere', 0);
    submitLocationResult('job-2', { status: 'ok', lat: 13.75633123456, lng: 100.50176599 }, 1);
    const job = getLocationJob('job-2', 1)!;
    expect(job.lat).toBe(13.756331);
    expect(job.lng).toBe(100.501766);
  });

  it('accepts a repeat of the same final result as a duplicate, not an error', () => {
    createLocationJob('job-3', 'X', 0);
    submitLocationResult('job-3', { status: 'not_found' }, 1);
    const again = submitLocationResult('job-3', { status: 'ok', lat: 1, lng: 2 }, 2);
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(getLocationJob('job-3', 2)!.status).toBe('needs_info');
  });

  it('rejects out-of-range or missing coordinates', () => {
    createLocationJob('job-4', 'X', 0);
    expect(submitLocationResult('job-4', { status: 'ok', lat: 91, lng: 0 }, 1)).toEqual({ ok: false, error: 'invalid_result' });
    expect(submitLocationResult('job-4', { status: 'ok' }, 1)).toEqual({ ok: false, error: 'invalid_result' });
    expect(getLocationJob('job-4', 1)!.status).toBe('queued');
  });

  it('times a job out after 10 minutes and refuses late results', () => {
    createLocationJob('job-5', 'X', 0);
    const late = LOCATION_JOB_TIMEOUT_MS + 1;
    expect(listQueuedLocationJobs(late)).toHaveLength(0);
    // First attempt times out -> shop is asked once (needs_info), not silently dropped.
    expect(getLocationJob('job-5', late)!.status).toBe('needs_info');
    expect(submitLocationResult('job-5', { status: 'ok', lat: 1, lng: 1 }, late)).toEqual({ ok: true, job: expect.anything(), duplicate: true });
  });

  it('asks the shop once: first failure -> needs_info, retry -> second failure -> failed', () => {
    createLocationJob('job-6', 'Pho 54', 0);
    expect(submitLocationResult('job-6', { status: 'not_found' }, 1)).toMatchObject({ ok: true, job: { status: 'needs_info' } });
    const retry = retryLocationJob('job-6', ' Pho 54 Ari Soi 4 ', 2);
    expect(retry).toMatchObject({ ok: true, job: { status: 'queued', attempts: 2, placeName: 'Pho 54 Ari Soi 4' } });
    expect(submitLocationResult('job-6', { status: 'error' }, 3)).toMatchObject({ ok: true, job: { status: 'failed', lat: null, lng: null } });
    expect(retryLocationJob('job-6', 'again', 4)).toEqual({ ok: false, error: 'not_waiting_for_info' });
  });

  it('saves coordinates after a successful retry', () => {
    createLocationJob('job-7', 'Somewhere', 0);
    submitLocationResult('job-7', { status: 'not_found' }, 1);
    retryLocationJob('job-7', 'Somewhere else', 2);
    submitLocationResult('job-7', { status: 'ok', lat: 13.75, lng: 100.5 }, 3);
    expect(getLocationJob('job-7', 3)).toMatchObject({ status: 'ok', attempts: 2, lat: 13.75, lng: 100.5 });
  });

  it('reports the number of jobs ahead in the location queue', () => {
    createLocationJob('q-1', 'A', 0);
    createLocationJob('q-2', 'B', 10);
    createLocationJob('q-3', 'C', 20);
    expect(locationQueuePosition('q-1', 30)).toBe(0);
    expect(locationQueuePosition('q-3', 30)).toBe(2);
    submitLocationResult('q-1', { status: 'ok', lat: 1, lng: 1 }, 31);
    expect(locationQueuePosition('q-3', 32)).toBe(1);
  });

  it('refuses retry for unknown jobs', () => {
    expect(retryLocationJob('missing', 'x', 0)).toEqual({ ok: false, error: 'unknown_job' });
  });

  it('reports unknown job ids', () => {
    expect(submitLocationResult('nope', { status: 'error' }, 0)).toEqual({ ok: false, error: 'unknown_job' });
  });
});

describe('extractPlaceFromBrief', () => {
  it('reads an explicit place line from the brief', () => {
    expect(extractPlaceFromBrief('ทำคลิปโปรโมชัน\nสถานที่: Pho 54 ย่านอารีย์\nลดราคา 20%')).toBe('Pho 54 ย่านอารีย์');
  });
  it('returns null when there is no marker', () => {
    expect(extractPlaceFromBrief('A restaurant serving noodles near the station')).toBeNull();
  });
});
