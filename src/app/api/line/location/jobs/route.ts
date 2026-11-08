import { NextRequest, NextResponse } from 'next/server';
import { listQueuedLocationJobs } from '@/services/line/locationBridge';
import { locationBridgeAuth } from '@/services/line/locationBridgeAuth';

/** GET: queued place names for the coordinates provider. */
export async function GET(req: NextRequest) {
  const denied = locationBridgeAuth(req);
  if (denied) return denied;
  const jobs = listQueuedLocationJobs(Date.now()).map(job => ({ jobId: job.jobId, placeName: job.placeName }));
  return NextResponse.json({ jobs });
}
