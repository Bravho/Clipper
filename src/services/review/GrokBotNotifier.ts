/**
 * GrokBotNotifier — fires a signed webhook to the Grok Bot review channel
 * whenever a review item needs attention.
 *
 * Config env vars (from .env.example):
 *   GROKBOT_REVIEW_WEBHOOK_URL         — POST target (omit to disable)
 *   GROKBOT_REVIEW_WEBHOOK_KEY         — HMAC-SHA256 signing key; also the fallback bearer token
 *   GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER — if non-empty (trimmed), sent VERBATIM as Authorization
 *                                        header value (do not add a Bearer prefix); otherwise
 *                                        falls back to `Bearer <KEY>`.
 *
 * Configured = URL set AND (AUTH_HEADER non-empty OR KEY set).
 * HMAC headers (X-Grokbot-Signature / X-Grokbot-Timestamp) are included whenever KEY is set,
 * regardless of whether AUTH_HEADER is used.
 *
 * Payload intentionally contains no PII — only IDs, typeKey, and expiring
 * signed preview links. Callers should always await and catch; failures are
 * logged but must never block the review pipeline. The key, the Authorization
 * header value, GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER and the webhook URL (which
 * may itself embed a secret) are never logged.
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

/**
 * Reads the three GrokBot webhook env vars at call time and derives the
 * Authorization header value to send plus whether the notifier is configured.
 *
 * configured = URL set AND (auth header non-empty OR KEY set)
 * authHeaderValue = GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER (trimmed) if non-empty,
 *                   else "Bearer <KEY>" when KEY is set, else "".
 */
export function resolveGrokBotWebhookAuth(): {
  url: string;
  authHeaderValue: string;
  key: string | undefined;
  rawAuthHeader: string;
  /** The original trimmed env value before label-stripping (used for redaction). */
  envAuthHeader: string;
  configured: boolean;
} {
  const url = (process.env.GROKBOT_REVIEW_WEBHOOK_URL ?? '').trim();
  const envAuthHeader = (process.env.GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER ?? '').trim();
  // Strip a leading "Authorization:" label (case-insensitive, optional surrounding whitespace).
  const rawAuthHeader = envAuthHeader.replace(/^\s*authorization\s*:\s*/i, '').trim();
  const key = process.env.GROKBOT_REVIEW_WEBHOOK_KEY || undefined;
  const configured = !!url && (!!rawAuthHeader || !!key);
  const authHeaderValue = rawAuthHeader || (key ? `Bearer ${key}` : '');
  return { url, authHeaderValue, key, rawAuthHeader, envAuthHeader, configured };
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

/**
 * Returns TRUE only when the webhook answered 2xx. FALSE when the notifier is
 * not configured (nothing was sent) or, without throwOnFailure, when delivery
 * failed. Callers that record delivery (the outbox) must check it.
 */
export async function notifyGrokBot(
  item: NotifiableItem,
  opts: GrokBotNotifierOptions,
): Promise<boolean> {
  const { url: webhookUrl, authHeaderValue, key: webhookKey, rawAuthHeader, envAuthHeader, configured } = resolveGrokBotWebhookAuth();
  if (!configured) return false;

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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': authHeaderValue,
    'X-Grokbot-Timestamp': String(timestamp),
  };
  if (webhookKey) {
    headers['X-Grokbot-Signature'] = `sha256=${sign(body, webhookKey, timestamp)}`;
  }

  // Build redaction list: key, URL, auth header value (cleaned and original env), token portion.
  const secretsToRedact: (string | undefined)[] = [webhookKey, webhookUrl];
  if (envAuthHeader) secretsToRedact.push(envAuthHeader);
  if (rawAuthHeader) {
    secretsToRedact.push(rawAuthHeader);
    const spaceIdx = rawAuthHeader.indexOf(' ');
    if (spaceIdx !== -1) {
      const tokenPart = rawAuthHeader.slice(spaceIdx + 1).trim();
      if (tokenPart) secretsToRedact.push(tokenPart);
    }
  }

  const post = opts.postFn ?? defaultPost;
  try {
    const res = await post(webhookUrl, body, headers);
    if (!res.ok) {
      throw new Error(`GrokBot webhook returned ${res.status}`);
    }
    return true;
  } catch (err) {
    const safe = redactSecrets(err, secretsToRedact);
    if (opts.throwOnFailure) throw safe;
    console.error('[GrokBotNotifier] failed to deliver webhook:', safe.message);
    return false;
  }
}
