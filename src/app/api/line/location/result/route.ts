import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { submitLocationResult } from '@/services/line/locationBridge';
import { locationBridgeAuth } from '@/services/line/locationBridgeAuth';
import { notifyLocationRetry } from '@/services/line/locationRetryNotice';

const bodySchema = z.object({
  jobId: z.string().min(1).max(100),
  status: z.enum(['ok', 'not_found', 'error']),
  lat: z.number().optional(),
  lng: z.number().optional(),
}).strict();

/** POST: coordinates provider posts one result per job. Coordinates only — no links, no text. */
export async function POST(req: NextRequest) {
  const denied = locationBridgeAuth(req);
  if (denied) return denied;
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const outcome = submitLocationResult(body.jobId, { status: body.status, lat: body.lat, lng: body.lng }, Date.now());
  if (!outcome.ok) {
    const status = outcome.error === 'unknown_job' ? 404 : outcome.error === 'expired' ? 409 : 400;
    return NextResponse.json({ error: outcome.error }, { status });
  }
  if (!outcome.duplicate) {
    if (outcome.job.status === 'ok' && outcome.job.lat !== null && outcome.job.lng !== null) {
      const { clipRequestRepository } = await import('@/repositories');
      await clipRequestRepository.update(outcome.job.jobId, { latitude: outcome.job.lat, longitude: outcome.job.lng });
    } else if (outcome.job.status === 'needs_info') {
      // First attempt failed: ask the shop once for a better place name.
      await notifyLocationRetry(outcome.job.jobId);
    }
  }
  return NextResponse.json({ ok: true, status: outcome.job.status, duplicate: outcome.duplicate });
}
