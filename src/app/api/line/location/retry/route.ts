import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { retryLocationJob } from '@/services/line/locationBridge';
import { locationBridgeAuth } from '@/services/line/locationBridgeAuth';

const bodySchema = z.object({
  jobId: z.string().min(1).max(100),
  placeName: z.string().trim().min(1).max(150),
}).strict();

/**
 * POST: after the shop gives a better place name, queue the one allowed retry.
 * Only a job in `needs_info` can be retried, and only once.
 */
export async function POST(req: NextRequest) {
  const denied = locationBridgeAuth(req);
  if (denied) return denied;
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const outcome = retryLocationJob(body.jobId, body.placeName, Date.now());
  if (!outcome.ok) {
    const status = outcome.error === 'unknown_job' ? 404 : 409;
    return NextResponse.json({ error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, status: outcome.job.status, attempts: outcome.job.attempts });
}
