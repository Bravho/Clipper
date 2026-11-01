/**
 * GrokBotNotifier — fires a signed webhook to the Grok Bot review channel
 * whenever a review item needs attention.
 *
 * Config env vars (from .env.example):
 *   GROKBOT_REVIEW_WEBHOOK_URL  — POST target (omit to disable)
 *   GROKBOT_REVIEW_WEBHOOK_KEY  — HMAC-SHA256 signing key
 *
 * Request headers:
 *   X-Grokbot-Signature: sha256=<hex>
 *   X-Grokbot-Timestamp: <unix epoch seconds>
 *   Content-Type: application/json
 *
 * Payload intentionally contains no PII — only IDs, typeKey, and expiring
 * signed preview links. Callers should always await and catch; failures are
 * logged but must never block the review pipeline.
 */

import { createHmac } from 'crypto';
import type { ReviewItem } from '@/domain/models/ReviewItem';

export interface GrokBotPayload {
  event: 'review_pending';
  itemId: string;
  shortCode: string;
  typeKey: string;
  audience: string;
  orderId: string | null;
  summaryTh: string;
  previewLinks: { role: string; url: string; mime: string }[];
  notifiedAt: string;
}

export interface GrokBotNotifierOptions {
  /** Generate a signed expiring URL for a storage key. Injected so tests can mock it. */
  signedUrl: (storageKey: string, ttlSeconds: number) => Promise<string>;
  /** Perform the HTTP POST. Injected so tests can mock it. */
  postFn?: (url: string, body: string, headers: Record<string, string>) => Promise<{ ok: boolean; status: number }>;
}

const DEFAULT_TTL = 3600; // 1-hour preview links

function buildSummaryTh(item: ReviewItem): string {
  const labels: Record<string, string> = {
    script: 'สคริปต์รอตรวจ',
    tts: 'เสียงพากย์รอตรวจ',
    video: 'วิดีโอรอตรวจ',
    customer_reply: 'ลูกค้าต้องการคุยกับทีม',
    out_of_package: 'แพ็กเกจหมด — รอดูแล',
    complaint: 'ร้องเรียน — ด่วน',
  };
  return labels[item.typeKey] ?? `รายการ ${item.typeKey} รอตรวจ`;
}

function sign(body: string, key: string, timestamp: number): string {
  return createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
}

async function defaultPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });
  return { ok: res.ok, status: res.status };
}

export async function notifyGrokBot(
  item: ReviewItem,
  opts: GrokBotNotifierOptions,
): Promise<void> {
  const webhookUrl = process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  const webhookKey = process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  if (!webhookUrl || !webhookKey) return;

  const previewLinks = await Promise.all(
    (item.assetRefs ?? []).map(async (ref) => ({
      role: ref.role,
      mime: ref.mime,
      url: await opts.signedUrl(ref.storage_key, DEFAULT_TTL).catch(() => ''),
    })),
  );

  const payload: GrokBotPayload = {
    event: 'review_pending',
    itemId: item.id,
    shortCode: item.shortCode,
    typeKey: item.typeKey,
    audience: String(item.payload.audience ?? 'admin'),
    orderId: item.packageOrderId ?? null,
    summaryTh: buildSummaryTh(item),
    previewLinks,
    notifiedAt: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = sign(body, webhookKey, timestamp);
  const headers = {
    'Content-Type': 'application/json',
    'X-Grokbot-Signature': `sha256=${sig}`,
    'X-Grokbot-Timestamp': String(timestamp),
  };

  const post = opts.postFn ?? defaultPost;
  try {
    const res = await post(webhookUrl, body, headers);
    if (!res.ok) {
      console.warn(`[GrokBotNotifier] webhook returned ${res.status} for item ${item.id}`);
    }
  } catch (err) {
    console.error('[GrokBotNotifier] failed to deliver webhook:', err);
  }
}
