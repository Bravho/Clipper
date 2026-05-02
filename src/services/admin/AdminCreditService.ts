import {
  userRepository,
  creditWalletRepository,
  creditTransactionRepository,
} from "@/repositories";
import { Role } from "@/domain/enums/Role";
import { TransactionType } from "@/domain/enums/TransactionType";
import { CreditTransaction } from "@/domain/models/CreditTransaction";
import { User } from "@/domain/models/User";

/**
 * AdminCreditService — admin-side credit visibility and management.
 *
 * Provides read operations for the admin credits page.
 * Credit grants (manual admin adjustments) are scaffolded as placeholders —
 * the actual API integration for granting credits will reuse CreditService.
 *
 * TODO: Admin credit grant UI — call CreditService.grantCredits() from admin API route.
 * TODO: PostgreSQL — all repos here are Postgres-backed (Phase 2A).
 */

export interface RequesterCreditSummary {
  user: User;
  balance: number;
  totalGranted: number;
  totalUsed: number;
  transactionCount: number;
  lastTransactionAt: Date | null;
}

export class AdminCreditService {
  /**
   * Get credit summaries for all requesters.
   * Returns balance + usage + grant totals for the credits overview page.
   */
  async getAllRequesterCreditSummaries(): Promise<RequesterCreditSummary[]> {
    const requesters = (await userRepository.listAll()).filter(
      (u) => u.role === Role.Requester
    );

    const summaries = await Promise.all(
      requesters.map(async (user) => {
        const [wallet, transactions] = await Promise.all([
          creditWalletRepository.findByUserId(user.id),
          creditTransactionRepository.findByUserId(user.id),
        ]);

        const totalGranted = transactions
          .filter((t) =>
            [TransactionType.SignupBonus, TransactionType.AdminCredit].includes(t.type)
          )
          .reduce((sum, t) => sum + t.amount, 0);

        const totalUsed = transactions
          .filter((t) => t.type === TransactionType.RequestCharge)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const sortedTxns = [...transactions].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );

        return {
          user,
          balance: wallet?.balance ?? 0,
          totalGranted,
          totalUsed,
          transactionCount: transactions.length,
          lastTransactionAt: sortedTxns[0]?.createdAt ?? null,
        };
      })
    );

    return summaries;
  }

  /**
   * Get full credit transaction history for a specific user.
   * Used on the admin request detail or user detail page.
   */
  async getUserTransactions(userId: string): Promise<CreditTransaction[]> {
    return creditTransactionRepository.findByUserId(userId);
  }

  /**
   * Get platform-wide credit stats.
   * Used for the admin credits summary cards.
   */
  async getPlatformCreditStats(): Promise<{
    totalSignupCreditsGranted: number;
    totalAdminCreditsGranted: number;
    totalCreditsUsed: number;
    totalActiveBalance: number;
    requesterCount: number;
  }> {
    const requesters = (await userRepository.listAll()).filter(
      (u) => u.role === Role.Requester
    );

    let totalSignupCreditsGranted = 0;
    let totalAdminCreditsGranted = 0;
    let totalCreditsUsed = 0;
    let totalActiveBalance = 0;

    await Promise.all(
      requesters.map(async (user) => {
        const [wallet, transactions] = await Promise.all([
          creditWalletRepository.findByUserId(user.id),
          creditTransactionRepository.findByUserId(user.id),
        ]);

        totalActiveBalance += wallet?.balance ?? 0;

        for (const t of transactions) {
          if (t.type === TransactionType.SignupBonus) {
            totalSignupCreditsGranted += t.amount;
          } else if (t.type === TransactionType.AdminCredit) {
            totalAdminCreditsGranted += t.amount;
          } else if (t.type === TransactionType.RequestCharge) {
            totalCreditsUsed += Math.abs(t.amount);
          }
        }
      })
    );

    return {
      totalSignupCreditsGranted,
      totalAdminCreditsGranted,
      totalCreditsUsed,
      totalActiveBalance,
      requesterCount: requesters.length,
    };
  }
}

export const adminCreditService = new AdminCreditService();
