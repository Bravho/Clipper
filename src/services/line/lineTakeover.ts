import type { LineAccount } from '@/domain/models/LineAccount';
import type { ILineAccountRepository } from '@/repositories/interfaces/ILineAccountRepository';

/** Check all linked accounts before automatic work and lazily clear expiry. */
export async function hasActiveTakeover(repo: ILineAccountRepository, accounts: LineAccount[]): Promise<boolean> {
  let active = false;
  for (const account of accounts) {
    if (!account.takeoverActive) continue;
    if (account.takeoverExpiresAt && account.takeoverExpiresAt <= new Date()) {
      await repo.setTakeover(account.id, false, null);
    } else active = true;
  }
  return active;
}
