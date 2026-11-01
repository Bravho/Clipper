/**
 * ReviewReminderService — sends Grok Bot reminders for pending review items
 * that have been unanswered past their reminder window.
 *
 * Driven by a cron/script: call runReviewReminders() periodically.
 * Pending items older than REVIEW_REMINDER_HOURS (default 12) receive one
 * Grok Bot notification, recorded in reminder_sent_at. Never messages shops.
 */

import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { notifyGrokBot, GrokBotNotifierOptions } from './GrokBotNotifier';


export async function runReviewReminders(
  reviewItemRepo: IReviewItemRepository,
  grokBotOpts: GrokBotNotifierOptions,
): Promise<{ reminded: number; errors: number }> {
  if (!process.env.GROKBOT_REVIEW_WEBHOOK_URL || !process.env.GROKBOT_REVIEW_WEBHOOK_KEY) return { reminded: 0, errors: 0 };
  const now = new Date();
  const due = await reviewItemRepo.listDueForReminder(now);
  let reminded = 0;
  let errors = 0;

  for (const item of due) {
    let claimed = false;
    try {
      claimed = await reviewItemRepo.claimReminder(item.id, now);
      if (!claimed) continue;
      await notifyGrokBot(item, { ...grokBotOpts, event: 'reminder', throwOnFailure: true });
      reminded++;
    } catch (err) {
      if (claimed) await reviewItemRepo.update(item.id, { reminderSentAt: null, nextReminderAt: item.nextReminderAt, reminderCount: item.reminderCount }).catch(() => {});
      console.error(`[ReviewReminderService] failed for item ${item.id}:`, err);
      errors++;
    }
  }

  return { reminded, errors };
}
