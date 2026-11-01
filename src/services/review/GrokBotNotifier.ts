/**
 * GrokBotNotifier — fires a signed webhook to the Grok Bot review channel
 * whenever a review item needs attention.
 *
 * Config env vars (from .env.example):
 *   GROKBOT_REVIEW_WEBHOOK_URL  — POST target (omit to disable)
 *   GROKBOT_REVIEW_WEBHOOK_KEY  — bearer token for the receiver (also the HMAC-SHA256 key)
 *
 * Request headers:
 *   Authorization: Bearer <GROKBOT_REVIEW_WEBHOOK_KEY>   (what Grok Bot routine triggers verify)
 *   X-Grokbot-Signature: sha256=<hex>                    (optional extra check for receivers that can)
 *   X-Grokbot-Timestamp: <unix epoch seconds>
 *   Content-Type: application/json
 *
 * Payload intentionally contains no PII — only IDs, typeKey, and expiring
 * signed preview links. Callers should always await and catch; failures are
 * logged but must never block the review pipeline. The key, the Authorization
 * header and the webhook URL (which may itself embed a secret) are never logged.
 */

import { createHmac } from 'crypto';
import type { ReviewItem } from '@/domain/models/ReviewItem';

type NotifiableItem = Pick<ReviewItem, 'id' | 'shortCode' | 'typeKey' | 'requestId' | 'packageOrderId' | 'payload' | 'assetRefs' | 'signals'>;

export interface GrokBotPayload {
  event: 'review_pending' | 'review_needed' | 'escalation' | 'reminder' | 'takeover_on';
  requestId: string | null;
  itemId: string;
  shortCode: string;
  typeKey: string;
  audience?: string;
  orderId: string | null;
  summaryTh: string;
  previewLinks: { role: string; url: string; mime: string }[];
  /** Short Thai issue strings from the storyboard AI pre-review. Absent when all checks passed. No PII. */
  precheckIssues?: string[];
  visualShotFlags?: { sceneIndex: number; assetId: string; rule: string; measuredValue: number }[];
  notifiedAt: string;
}

export interface GrokBotNotifierOptions {
  event?: GrokBotPayload['event'];
  throwOnFailure?: boolean;
  /** Generate a signed expiring URL for a storage key. Injected so tests can mock it. */
  signedUrl: (storageKey: string, ttlSeconds: number) => Promise<string>;
  /** Perform the HTTP POST. Injected so tests can mock it. */
  postFn?: (url: string, body: string, headers: Record<string, string>) => Promise<{ ok: boolean; status: number }>;
  /** Override the generated Thai summary (used by the synthetic test event script). */
  summaryTh?: string;
}

/** Remove secrets from an error before it is logged or rethrown. */
export function redactSecrets(err: unknown, secrets: (string | undefined)[]): Error {
  let msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? ` (cause: ${err.cause.message})` : '';
  msg += cause;
  for (const s of secrets) if (s) msg = msg.split(s).join('[REDACTED]');
  msg = msg.replace(/Bearer\s+[^\s"',)]+/gi, 'Bearer [REDACTED]');
  return new Error(msg);
}

const DEFAULT_TTL = 3600; // 1-hour preview links

function buildSummaryTh(item: NotifiableItem): string {
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

export async function defaultPost(
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
  item: NotifiableItem,
  opts: GrokBotNotifierOptions,
): Promise<void> {
  const webhookUrl = process.env.GROKBOT_REVIEW_WEBHOOK_URL;
  const webhookKey = process.env.GROKBOT_REVIEW_WEBHOOK_KEY;
  if (!webhookUrl || !webhookKey) return;

  const escalation = opts.event === 'escalation' || item.typeKey === 'customer_reply';
  const previewLinks = escalation ? [] : await Promise.all(
    (item.typeKey === 'customer_reply' ? [] : item.assetRefs ?? []).map(async (ref) => ({
      role: ref.role,
      mime: ref.mime,
      url: await opts.signedUrl(ref.storage_key, DEFAULT_TTL).catch(() => ''),
    })),
  );

  const rawIssues = item.signals?.precheckIssues;
  const precheckIssues = Array.isArray(rawIssues) && rawIssues.length > 0
    ? (rawIssues as unknown[]).map(String)
    : undefined;

  const payload: GrokBotPayload = {
    event: opts.event ?? 'review_needed',
    requestId: item.requestId ?? null,
    itemId: item.id,
    shortCode: item.shortCode,
    typeKey: item.typeKey,
    ...(!escalation ? { audience: String(item.payload.audience ?? 'admin') } : {}),
    orderId: item.packageOrderId ?? null,
    summaryTh: escalation ? 'ลูกค้าส่งข้อความที่ระบบตอบไม่ได้ — รอทีมงาน/RCaveBot ตอบ' : opts.summaryTh ?? buildSummaryTh(item),
    previewLinks,
    ...(!escalation && precheckIssues ? { precheckIssues } : {}),
    ...(!escalation && Array.isArray(item.signals?.visualShotFlags) ? { visualShotFlags: item.signals.visualShotFlags.flatMap((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return [];
      const f = raw as Record<string, unknown>;
      const rules = ['min_shot','hero_hold','first_hold','last_hold','cut_gap','ambiguous_assets','analysis_missing','usable_duration','source_cut','low_confidence','product_center','product_area','product_clipped','total_duration','analysis_error','empty_plan'];
      if (!Number.isInteger(f.sceneIndex) || typeof f.assetId !== 'string' || (f.assetId !== '' && !/^[a-f0-9-]{36}$/i.test(f.assetId)) || !rules.includes(String(f.rule)) || typeof f.measuredValue !== 'number' || !Number.isFinite(f.measuredValue)) return [];
      return [{ sceneIndex: f.sceneIndex as number, assetId: f.assetId, rule: String(f.rule), measuredValue: f.measuredValue }];
    }) } : {}),
    notifiedAt: new Date().toISOString(),
  };

  // Strict allowlist for handoffs: customer-controlled fields never leave here.
  const body = JSON.stringify(item.typeKey === 'customer_reply' ? {
    event: opts.event ?? 'escalation', requestId: item.requestId ?? null,
    itemId: item.id, shortCode: item.shortCode, typeKey: item.typeKey, orderId: item.packageOrderId ?? null,
    summaryTh: opts.event === 'takeover_on' ? 'ทีมงานเข้ารับช่วงการสนทนาแล้ว (takeover)'
      : 'ลูกค้าส่งข้อความที่ระบบตอบไม่ได้ — รอทีมงาน/RCaveBot ตอบ', previewLinks: [],
    notifiedAt: payload.notifiedAt,
  } : payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = sign(body, webhookKey, timestamp);
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${webhookKey}`,
    'X-Grokbot-Signature': `sha256=${sig}`,
    'X-Grokbot-Timestamp': String(timestamp),
  };

  const post = opts.postFn ?? defaultPost;
  try {
    const res = await post(webhookUrl, body, headers);
    if (!res.ok) {
      throw new Error(`GrokBot webhook returned ${res.status}`);
    }
  } catch (err) {
    const safe = redactSecrets(err, [webhookKey, webhookUrl]);
    if (opts.throwOnFailure) throw safe;
    console.error('[GrokBotNotifier] failed to deliver webhook:', safe.message);
  }
}
