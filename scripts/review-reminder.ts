/**
 * scripts/review-reminder.ts
 *
 * One-shot script: find pending review items past their reminder window and
 * notify Grok Bot. Intended for cron (e.g. every 30 minutes).
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/review-reminder.ts
 *
 * Required env vars:
 *   GROKBOT_REVIEW_WEBHOOK_URL, GROKBOT_REVIEW_WEBHOOK_KEY (see .env.example)
 *   Database connection vars (PGHOST, PGDATABASE, etc.)
 *
 * Optional:
 *   REVIEW_REMINDER_HOURS — age in hours before the one-time reminder (default 12)
 */

import { runReviewReminders } from '../src/services/review/ReviewReminderService';
import { reviewItemRepository } from '../src/repositories/index';
import { spacesSignedUrl } from '../src/lib/spaces';

async function main() {
  const { reminded, errors } = await runReviewReminders(reviewItemRepository, {
    signedUrl: (key, ttl) => spacesSignedUrl(key, ttl),
  });
  console.log(`[review-reminder] reminded=${reminded} errors=${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[review-reminder] fatal:', err);
  process.exit(1);
});
