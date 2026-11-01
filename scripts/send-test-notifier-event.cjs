#!/usr/bin/env node
/**
 * Sends ONE synthetic, clearly-marked test event (review_pending) to the
 * Grok Bot review webhook through the real notifier code path
 * (src/services/review/GrokBotNotifier.ts → notifyGrokBot).
 *
 * Reads GROKBOT_REVIEW_WEBHOOK_URL / GROKBOT_REVIEW_WEBHOOK_KEY /
 * GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER from .env.local (falls back to .env).
 * Prints ONLY the HTTP status (or "skipped"/"error").
 * Never prints the URL, key, auth header or body. No DB access, no customer data.
 *
 * Authorization precedence:
 *   GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER (trimmed, verbatim) if non-empty,
 *   else Bearer <GROKBOT_REVIEW_WEBHOOK_KEY>.
 * HMAC headers sent when GROKBOT_REVIEW_WEBHOOK_KEY is set.
 * Configured = URL set AND (AUTH_HEADER non-empty OR KEY set).
 *
 * Usage (from the repo root):  node scripts/send-test-notifier-event.cjs
 */
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const dotenv = require('dotenv');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
}
const tsx = require('tsx/cjs/api');
const { notifyGrokBot, defaultPost, resolveGrokBotWebhookAuth } = tsx.require(path.join(root, 'src/services/review/GrokBotNotifier.ts'), __filename);

(async () => {
  const { configured } = resolveGrokBotWebhookAuth();
  if (!configured) {
    console.log('skipped: GROKBOT_REVIEW_WEBHOOK_URL is not set, or neither GROKBOT_REVIEW_WEBHOOK_AUTH_HEADER nor GROKBOT_REVIEW_WEBHOOK_KEY is set');
    process.exitCode = 2;
    return;
  }
  const stamp = Date.now();
  let status = null;
  const item = {
    id: `test-item-${stamp}`, shortCode: 'TEST00', typeKey: 'test', requestId: `test-request-${stamp}`,
    packageOrderId: null, payload: { audience: 'admin' }, assetRefs: [], signals: {},
  };
  try {
    await notifyGrokBot(item, {
      event: 'review_pending',
      summaryTh: 'ทดสอบการแจ้งเตือนจากระบบ RClipper (test)',
      throwOnFailure: true,
      signedUrl: async () => '',
      postFn: async (url, body, headers) => { const r = await defaultPost(url, body, headers); status = r.status; return r; },
    });
    console.log(`HTTP ${status}`);
  } catch (err) {
    // notifyGrokBot already redacts the key/URL from errors.
    console.log(status !== null ? `HTTP ${status}` : `error: ${err && err.message}`);
    process.exitCode = 1;
  }
})();
