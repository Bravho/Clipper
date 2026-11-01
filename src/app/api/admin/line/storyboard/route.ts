import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { storyboardVersionRepository } from '@/repositories';
import { sceneEditEnabled } from '@/services/line/LineSceneEditService';
const bodySchema = z.object({ action: z.literal('restore'), requestId: z.string().uuid(), versionId: z.string().uuid(), expectedVersionId: z.string().uuid() }).strict();
/** Restoring copies the old content to a new immutable version and queues checks/render. */
export async function POST(req: NextRequest) {
 const secret = process.env.REVIEW_ADMIN_TOKEN;
 if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
 const auth = req.headers.get('authorization') ?? '';
 const supplied = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
 const expected = Buffer.from(secret);
 if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
 if (!sceneEditEnabled()) return NextResponse.json({ error: 'disabled' }, { status: 503 });
 try {
  const body = bodySchema.parse(await req.json());
  const current = await storyboardVersionRepository.latest(body.requestId);
  const old = await storyboardVersionRepository.get(body.versionId);
  if (!current || !old || old.requestId !== body.requestId || old.isTest !== current.isTest || (process.env.LINE_TEST_MODE === 'true' && !current.isTest)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (current.id !== body.expectedVersionId) return NextResponse.json({ error: 'version_conflict' }, { status: 409 });
  const version = await storyboardVersionRepository.append({ requestId: current.requestId, parentVersionId: current.id,
   scenes: old.scenes, createdBy: 'admin', reason: 'restore:' + old.id, isTest: current.isTest });
  return NextResponse.json({ version });
 } catch (e) { return NextResponse.json({ error: e instanceof z.ZodError ? 'invalid_input' : (e as Error).message }, { status: e instanceof z.ZodError ? 400 : 409 }); }
}
