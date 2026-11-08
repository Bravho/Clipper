/**
 * POST /api/line/webhook
 *
 * LINE Messaging API webhook endpoint.
 *
 * Security:
 * - Reads raw body and verifies X-Line-Signature = base64(HMAC-SHA256(secret, rawBody)).
 * - Returns 401 if signature is missing or invalid.
 * - Returns 500 if event persistence fails (LINE will retry).
 * - LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN from env only.
 *
 * Deduplication:
 * - Inserts webhookEventId into line_webhook_events before processing.
 * - Duplicate events are silently skipped (200 OK).
 * - Returns 5xx if the dedup insert fails so LINE retries.
 *
 * Processing:
 * - Events are processed synchronously before returning 200.
 * - Each event error is caught so a single bad event doesn't fail the batch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyLineSignature, processLineEvent } from '@/services/line/LineWebhookService';
import { getLineChannelSecret } from '@/config/lineIntake';
import { LineClient } from '@/lib/line/LineClient';
import { lineAccountRepository, userRepository, servicePackageRepository, clipRequestRepository,
  uploadedAssetRepository, videoGenerationJobRepository, createReviewService } from '@/repositories/index';
import { notifyOpenBotHandoff } from '@/lib/line/openbotHandoffWebhook';
import { takeoverActive as isTakeoverActive } from '@/services/line/lineHandoffPolicy';
import { lineRequestStatus } from '@/services/line/lineRequestStatus';
import { LineIntakeService } from '@/services/line/LineIntakeService';
import { getDefaultTypeCfg } from '@/services/review/ReviewService';
import { createHash } from 'crypto';
import { isLineIntakeEnabled } from '@/config/reviewSystem';
import { pool } from '@/lib/db';
import { handleSceneEditMessage } from '@/services/line/lineSceneEditRuntime';

const lineClient = new LineClient();
const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID ?? 'default';

/**
 * Try to record this event as processed. Returns false if already seen (duplicate).
 * Returns true if newly recorded. Throws on DB error so LINE gets a 5xx and retries.
 */
async function tryRecordEvent(eventId: string, eventType: string, payload: unknown): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO line_webhook_events (event_id,event_type,channel_id,payload,claimed_at)
     VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (event_id) DO UPDATE SET claimed_at=NOW()
     WHERE line_webhook_events.completed_at IS NULL AND
       (line_webhook_events.claimed_at IS NULL OR line_webhook_events.claimed_at < NOW() - interval '2 minutes') RETURNING event_id`,
    [eventId, eventType, LINE_CHANNEL_ID, JSON.stringify(payload)]);
  if ((result.rowCount ?? 0) > 0) return true;
  const existing = await pool.query('SELECT completed_at FROM line_webhook_events WHERE event_id=$1', [eventId]);
  if (existing.rows[0]?.completed_at) return false;
  // A concurrent handler or crashed lease must be retried, not acknowledged
  // as completed. A later redelivery can take over the expired lease.
  throw new Error('event_in_progress');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isLineIntakeEnabled()) {
    return NextResponse.json({ error: 'LINE intake is not enabled.' }, { status: 503 });
  }

  let secret: string;
  try {
    secret = getLineChannelSecret();
  } catch {
    console.error('[line/webhook] LINE_CHANNEL_SECRET not configured');
    return NextResponse.json({ error: 'Integration not configured.' }, { status: 500 });
  }

  // Read raw body for HMAC verification
  const rawBodyBytes = await request.arrayBuffer();
  const rawBody = Buffer.from(rawBodyBytes);

  const signature = request.headers.get('x-line-signature');
  if (!verifyLineSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  // Parse body
  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  // Process events synchronously — persist each event BEFORE processing,
  // then return 200 after all are handled.
  for (const rawEvent of events) {
    const event = rawEvent as Record<string, unknown> & {
      webhookEventId?: string;
      type?: string;
    };
    const eventId = event.webhookEventId ?? createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const eventType = (event.type as string) ?? 'unknown';

    if (eventId) {
      try {
        const isNew = await tryRecordEvent(eventId, eventType, event);
        if (!isNew) {
          // Duplicate — skip silently
          continue;
        }
      } catch (err) {
        console.error('[line/webhook] failed to persist event:', err);
        return NextResponse.json({ error: 'Event persistence failed.' }, { status: 500 });
      }
    }

    try {
      const intake = new LineIntakeService(LINE_CHANNEL_ID, lineAccountRepository, userRepository,
        servicePackageRepository, clipRequestRepository, uploadedAssetRepository);
      const outcome = await processLineEvent(event as Parameters<typeof processLineEvent>[0], {
        lineChannelId: LINE_CHANNEL_ID,
        lineClient,
        lineAccountRepo: lineAccountRepository,
        reviewMessages: async lineUserId => {
          const account = await intake.ensureAccount(lineUserId);
          const items = await createReviewService().listPending({ shopUserId: account.userId });
          const item = items.find(candidate => candidate.payload.audience === 'shop');
          if (!item) return [];
          const { issuePreviewToken } = await import('@/lib/review/previewToken');
          const ref = item.assetRefs[0];
          const token = await issuePreviewToken({ itemId: item.id, version: item.version, typeKey: item.typeKey,
            assetId: ref?.asset_id, storageKey: ref?.storage_key });
          const base = process.env.REVIEW_PUBLIC_ORIGIN;
          if (!base) throw new Error('REVIEW_PUBLIC_ORIGIN not configured');
          return [{ type: 'text', text: String(item.payload.script ?? '') + '\n' + base + '/r/' + token }];
        },
        requestStatus: async (requestId, lineUserId) => {
          const account = await lineAccountRepository.findByLineUser(LINE_CHANNEL_ID, lineUserId);
          const request = await clipRequestRepository.findById(requestId);
          if (!request || request.userId !== account?.userId) return 'ไม่พบงานค่ะ กรุณาติดต่อทีมงาน';
          const job = await videoGenerationJobRepository.findByRequestId(requestId);
          return lineRequestStatus(request.status, job);
        },
        sceneEditMessages: (user, text) => handleSceneEditMessage(LINE_CHANNEL_ID, user, text),
        findActiveBalance: (user) => intake.findActiveOrderWithBalance(user),
        choosePackage: (user, code) => intake.choosePackage(user, code),
        isPaid: (order, user) => intake.isPaid(order, user),
        submitClipRequest: async ({ lineUserId, context }) => {
          const submitted = await intake.submit(lineUserId, context);
          const { videoGenerationService } = await import('@/services/VideoGenerationService');
          const request = await clipRequestRepository.findById(submitted.requestId);
          if (!request) throw new Error('missing_request');
          // Coordinates come from LocBot via the bridge; the result is written back to this request.
          const { createLocationJob, getLocationJob } = await import('@/services/line/locationBridge');
          if (request.placeName && !getLocationJob(submitted.requestId, Date.now())) {
            createLocationJob(submitted.requestId, request.placeName, Date.now());
          }
          const assets = await uploadedAssetRepository.findByRequestId(request.id);
          const { withLineStorage } = await import('@/lib/line/storageContext');
          await withLineStorage(true, () => videoGenerationService.initializePipeline(request.id, request.userId, {
            imageUrls: assets.map(asset => asset.storageKey || asset.storageUrl), title: request.title,
            description: request.description, targetAudience: request.targetAudience,
            targetPlatforms: request.targetPlatforms, preferredStyle: request.preferredStyle }));
          return submitted;
        },
        fetchMediaContent: async messageId => {
          const res = await fetch('https://api-data.line.me/v2/bot/message/' + encodeURIComponent(messageId) + '/content', {
            headers: { Authorization: 'Bearer ' + process.env.LINE_CHANNEL_ACCESS_TOKEN } });
          if (!res.ok) throw new Error('media_download_failed');
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length > 100 * 1024 * 1024) throw new Error('media_too_large');
          const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
          if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) throw new Error('unsupported_media');
          if (contentType.startsWith('video/')) {
            const { validateLineFootage } = await import('@/lib/line/footageValidation');
            await validateLineFootage(buffer);
          }
          return { buffer, contentType };
        },
        createReviewItem: async ({ lineUserId, text, intent }) => {
          const account = await intake.ensureAccount(lineUserId);
          const { item: handoffItem, created: handoffCreated } = await createReviewService().createItem({ typeKey: 'customer_reply', shopUserId: account.userId,
            title: 'LINE: ' + intent, payload: { text, lineUserId }, signals: { wants_human: intent === 'wants_human' },
            idempotencyKey: 'line:' + eventId, typeCfg: { ...getDefaultTypeCfg('customer_reply'), alwaysReview: true } });
          if (handoffCreated) {
            const notice = await notifyOpenBotHandoff({ itemId: handoffItem.id, isTest: process.env.LINE_TEST_MODE === 'true', takeoverActive: isTakeoverActive(account) });
            if (notice === 'failed') console.error('[line/webhook] OpenBot handoff notice failed; item is in the review queue');
          }
        },
      });
      if (outcome.intent === 'file_error' || outcome.intent === 'submit_error') throw new Error(outcome.intent);
      await pool.query('UPDATE line_webhook_events SET completed_at=NOW() WHERE event_id=$1', [eventId]);
    } catch (err) {
      console.error('[line/webhook] event processing error:', err);
      await pool.query('UPDATE line_webhook_events SET claimed_at=NULL WHERE event_id=$1', [eventId]).catch(() => {});
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
