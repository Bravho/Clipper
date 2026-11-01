/**
 * ReviewReminderService — sends Grok Bot reminders for pending review items
 * that have been unanswered past their reminder window.
 *
 * Driven by a cron/script: call runReviewReminders() periodically.
 * Items whose nextReminderAt <= now receive a Grok Bot notification; their
 * nextReminderAt is bumped by REVIEW_REMINDER_HOURS (default 12) and
 * reminderCount is incremented so repeated firings don't spam.
 */

import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { notifyGrokBot, GrokBotNotifierOptions } from './GrokBotNotifier';

function getReminderHours(): number {
  const val = Number(process.env.REVIEW_REMINDER_HOURS ?? '12');
  return Number.isFinite(val) && val > 0 ? val : 12;
}

export async function runReviewReminders(
  reviewItemRepo: IReviewItemRepository,
  grokBotOpts: GrokBotNotifierOptions,
): Promise<{ reminded: number; errors: number }> {
  const now = new Date();
  const due = await reviewItemRepo.listDueForReminder(now);
  let reminded = 0;
  let errors = 0;

  for (const item of due) {
    try {
      await notifyGrokBot(item, grokBotOpts);
      const nextReminder = new Date(now.getTime() + getReminderHours() * 3600 * 1000);
      await reviewItemRepo.update(item.id, {
        nextReminderAt: nextReminder,
        reminderCount: item.reminderCount + 1,
      });
      reminded++;
    } catch (err) {
      console.error(`[ReviewReminderService] failed for item ${item.id}:`, err);
      errors++;
    }
  }

  return { reminded, errors };
}
