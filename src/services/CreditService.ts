import { CREDITS_CONFIG } from "@/config/credits";
import { TransactionType } from "@/domain/enums/TransactionType";
import { CreditWallet } from "@/domain/models/CreditWallet";
import { CreditTransaction } from "@/domain/models/CreditTransaction";
import {
  creditWalletRepository,
  creditTransactionRepository,
} from "@/repositories";

/**
 * CreditService — manages all credit wallet operations.
 *
 * Business rules enforced here:
 * - Signup bonus (30 credits) is granted exactly once per account.
 * - Credits cannot go below zero.
 *
 * TODO: When request submission is implemented, call deductCredits()
 *       inside the request creation flow.
 */
export class CreditService {
  async getBalance(userId: string): Promise<number> {
    const wallet = await creditWalletRepository.findByUserId(userId);
    return wallet?.balance ?? 0;
  }

  async getWallet(userId: string): Promise<CreditWallet | null> {
    return creditWalletRepository.findByUserId(userId);
  }

  async getTransactionHistory(userId: string): Promise<CreditTransaction[]> {
    return creditTransactionRepository.findByUserId(userId);
  }

  /**
   * Initialise a new credit wallet for a requester.
   * Creates the wallet and immediately grants the signup bonus.
   * Guards against double-grant using wallet.initialCreditsGranted.
   */
  async initialiseRequesterWallet(userId: string): Promise<CreditWallet> {
    const existing = await creditWalletRepository.findByUserId(userId);
    if (existing) {
      // Wallet already exists — only grant bonus if not yet granted
      if (!existing.initialCreditsGranted) {
        return this.grantSignupBonus(existing);
      }
      return existing;
    }

    // Create wallet with zero balance first, then grant bonus
    const wallet = await creditWalletRepository.create({
      userId,
      balance: 0,
      initialCreditsGranted: false,
    });

    return this.grantSignupBonus(wallet);
  }

  /**
   * Grant the 30-credit signup bonus.
   * Safe to call multiple times — idempotent via initialCreditsGranted flag.
   */
  async grantSignupBonus(wallet: CreditWallet): Promise<CreditWallet> {
    if (wallet.initialCreditsGranted) {
      // Guard: bonus already granted, do nothing
      return wallet;
    }

    const bonus = CREDITS_CONFIG.SIGNUP_BONUS_CREDITS;
    const updated = await creditWalletRepository.updateBalance(
      wallet.id,
      wallet.balance + bonus
    );

    await creditWalletRepository.markInitialCreditsGranted(wallet.id);

    await creditTransactionRepository.create({
      userId: wallet.userId,
      amount: bonus,
      type: TransactionType.SignupBonus,
      description: `Welcome! ${bonus} free credits on account creation.`,
      referenceId: null,
    });

    return { ...updated, initialCreditsGranted: true };
  }

  /**
   * Deduct credits for a clip request submission.
   * TODO: Call this from RequestService when request submission is built.
   */
  async deductCredits(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string
  ): Promise<CreditWallet> {
    const wallet = await creditWalletRepository.findByUserId(userId);
    if (!wallet) throw new Error("Credit wallet not found for user.");
    if (wallet.balance < amount) throw new Error("Insufficient credits.");

    const updated = await creditWalletRepository.updateBalance(
      wallet.id,
      wallet.balance - amount
    );

    await creditTransactionRepository.create({
      userId,
      amount: -amount,
      type: TransactionType.RequestCharge,
      description,
      referenceId: referenceId ?? null,
    });

    return updated;
  }

  async hasEnoughCredits(userId: string, amount: number): Promise<boolean> {
    const balance = await this.getBalance(userId);
    return balance >= amount;
  }
}

// Singleton instance for app usage
export const creditService = new CreditService();
