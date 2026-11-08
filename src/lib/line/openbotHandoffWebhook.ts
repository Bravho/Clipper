/**
 * Tells the OpenBot routine "Line handoff item for RCaveBot" that a LINE handoff
 * item was created, so RCaveBot can read it through the admin handoff route.
 *
 * Request format (confirmed by Tho from the OpenBot routine settings and a test):
 *   POST <OPENBOT_HANDOFF_WEBHOOK_URL>
 *   X-OpenBot-Timestamp: <unix seconds>
 *   X-OpenBot-Delivery-Id: <random hex>
 *   X-OpenBot-Signature: sha256=<HMAC-SHA256 hex of "<timestamp>.<deliveryId>.<body>" with the secret>
 *
 * Off unless OPENBOT_HANDOFF_WEBHOOK_URL, OPENBOT_HANDOFF_WEBHOOK_SECRET and
 * OPENBOT_HANDOFF_APP_ORIGIN are all set. Never throws: a failed notice must not
 * fail the LINE webhook, because the review item is already saved.
 */
import { createHmac, randomBytes } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HandoffNoticeInput {
  itemId: string;
  isTest: boolean;
  /** True while a human has taken over this shop's chat (see lineHandoffPolicy). */
  takeoverActive: boolean;
}

export type HandoffNoticeResult = 'sent' | 'skipped' | 'failed';

export function signOpenBotWebhook(body: string, timestamp: string, deliveryId: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${deliveryId}.${body}`).digest('hex');
  return `sha256=${hex}`;
}

export function buildHandoffNoticeBody(input: HandoffNoticeInput, origin: string): string {
  const itemId = input.itemId;
  return JSON.stringify({
    type: 'line.handoff.created',
    data: {
      event: 'customer_message',
      itemId,
      isTest: input.isTest,
      takeoverActive: input.takeoverActive,
      fetchUrl: `${origin.replace(/\/+$/, '')}/api/admin/line/handoff/${itemId}`,
    },
  });
}

export async function notifyOpenBotHandoff(
  input: HandoffNoticeInput,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): Promise<HandoffNoticeResult> {
  const url = env.OPENBOT_HANDOFF_WEBHOOK_URL;
  const secret = env.OPENBOT_HANDOFF_WEBHOOK_SECRET;
  const origin = env.OPENBOT_HANDOFF_APP_ORIGIN;
  if (!url || !secret || !origin) return 'skipped';
  if (!UUID_RE.test(input.itemId)) return 'failed';

  try {
    const body = buildHandoffNoticeBody(input, origin);
    const timestamp = String(Math.floor(nowMs() / 1000));
    const deliveryId = randomBytes(16).toString('hex');
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenBot-Timestamp': timestamp,
        'X-OpenBot-Delivery-Id': deliveryId,
        'X-OpenBot-Signature': signOpenBotWebhook(body, timestamp, deliveryId, secret),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
