import { CREDITS_CONFIG } from "@/config/credits";
import { TransactionType } from "@/domain/enums/TransactionType";
import { CreditWallet } from "@/domain/models/CreditWallet";
import { CreditTransaction } from "@/domain/models/CreditTransaction";
import {
  creditWalletRepository,
  creditTransactionRepository,
  creditPurchaseLogRepository,
} from "@/repositories";
import { pool } from "@/lib/db";
import { CreditPurchaseLog } from "@/domain/models/CreditPurchaseLog";

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

    // No free credits at launch (bonus = 0): mark granted so we don't re-check
    // on every signup, but skip the balance change and ledger noise.
    if (bonus <= 0) {
      await creditWalletRepository.markInitialCreditsGranted(wallet.id);
      return { ...wallet, initialCreditsGranted: true };
    }

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
   * Record a manual credit purchase.
   * Wraps the purchase log, wallet balance increment, and ledger transaction in a single database transaction.
   */
  async buyCreditsManual(
    userId: string,
    creditsAmount: number,
    pricePaidBaht: number,
    reference: string
  ): Promise<CreditWallet> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Record the financial log
      await creditPurchaseLogRepository.create({
        userId,
        creditsAdded: creditsAmount,
        amountBaht: pricePaidBaht,
        transactionRef: reference,
      });

      // 2. Fetch/create wallet
      let wallet = await creditWalletRepository.findByUserId(userId);
      if (!wallet) {
        wallet = await creditWalletRepository.create({
          userId,
          balance: 0,
          initialCreditsGranted: false,
        });
      }

      // 3. Increment balance
      const updatedWallet = await creditWalletRepository.updateBalance(
        wallet.id,
        wallet.balance + creditsAmount
      );

      // 4. Record to ledger
      await creditTransactionRepository.create({
        userId,
        amount: creditsAmount,
        type: TransactionType.AdminCredit,
        description: `Manual package top-up: ${creditsAmount} credits. Ref: ${reference}`,
        referenceId: null,
      });

      await client.query("COMMIT");
      return updatedWallet;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Credit a wallet from a confirmed gateway top-up (e.g. PromptPay via GB Prime Pay).
   *
   * Wraps the purchase log, wallet increment, and ledger entry in a single DB
   * transaction. Records a TopUp ledger entry (distinct from manual AdminCredit).
   * `reference` should be the gateway/payment-intent reference for traceability.
   *
   * Idempotency for re-delivered webhooks is enforced by PaymentService (it checks
   * the intent status before calling this), so this method just performs the credit.
   */
  async creditTopup(
    userId: string,
    creditsAmount: number,
    pricePaidBaht: number,
    reference: string
  ): Promise<CreditWallet> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await creditPurchaseLogRepository.create({
        userId,
        creditsAdded: creditsAmount,
        amountBaht: pricePaidBaht,
        transactionRef: reference,
      });

      let wallet = await creditWalletRepository.findByUserId(userId);
      if (!wallet) {
        wallet = await creditWalletRepository.create({
          userId,
          balance: 0,
          initialCreditsGranted: false,
        });
      }

      const updatedWallet = await creditWalletRepository.updateBalance(
        wallet.id,
        wallet.balance + creditsAmount
      );

      await creditTransactionRepository.create({
        userId,
        amount: creditsAmount,
        type: TransactionType.TopUp,
        description: `PromptPay top-up: ${creditsAmount} credits (฿${pricePaidBaht}). Ref: ${reference}`,
        referenceId: null,
      });

      await client.query("COMMIT");
      return updatedWallet;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Deduct credits for a clip request submission.
   * TODO: Call this from RequestService when request submission is built.
   */
  // TODO: PostgreSQL — wrap the transaction insert + wallet update in a single
  //   DB transaction (BEGIN/COMMIT) so both succeed or both roll back atomically.
  async deductCredits(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string
  ): Promise<CreditWallet> {
    const wallet = await creditWalletRepository.findByUserId(userId);
    if (!wallet) throw new Error("Credit wallet not found for user.");
    if (wallet.balance < amount) throw new Error("Insufficient credits.");

    // Insert the transaction record FIRST — if this fails (e.g. constraint error),
    // the wallet balance is never touched and no credits are lost.
    await creditTransactionRepository.create({
      userId,
      amount: -amount,
      type: TransactionType.RequestCharge,
      description,
      referenceId: referenceId ?? null,
    });

    const updated = await creditWalletRepository.updateBalance(
      wallet.id,
      wallet.balance - amount
    );

    return updated;
  }

  async refundCredits(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string
  ): Promise<CreditWallet> {
    const wallet = await creditWalletRepository.findByUserId(userId);
    if (!wallet) throw new Error("Credit wallet not found for user.");

    await creditTransactionRepository.create({
      userId,
      amount,
      type: TransactionType.RequestRefund,
      description,
      referenceId: referenceId ?? null,
    });

    return creditWalletRepository.updateBalance(wallet.id, wallet.balance + amount);
  }

  async hasEnoughCredits(userId: string, amount: number): Promise<boolean> {
    const balance = await this.getBalance(userId);
    return balance >= amount;
  }

  /**
   * Apply signup/earned credits as a ฿ discount at checkout.
   *
   * Rules:
   * - 1 credit = CREDIT_TO_BAHT_VALUE (฿10) off the price
   * - Cannot use more credits than the user holds
   * - Cannot bring the price below ฿0 (credits cover at most floor(priceBaht/CREDIT_TO_BAHT_VALUE))
   * - Records a DiscountApplied transaction
   *
   * Returns the discount breakdown; caller is responsible for recording payment.
   */
  async applyDiscount(
    userId: string,
    creditsToUse: number,
    priceBaht: number,
    referenceId?: string
  ): Promise<{ creditsDeducted: number; discountBaht: number; remainingBaht: number }> {
    if (creditsToUse <= 0) {
      return { creditsDeducted: 0, discountBaht: 0, remainingBaht: priceBaht };
    }

    const wallet = await creditWalletRepository.findByUserId(userId);
    if (!wallet) throw new Error("Credit wallet not found for user.");

    const maxByPrice = Math.floor(priceBaht / CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE);
    const creditsDeducted = Math.min(creditsToUse, wallet.balance, maxByPrice);

    if (creditsDeducted === 0) {
      return { creditsDeducted: 0, discountBaht: 0, remainingBaht: priceBaht };
    }

    const discountBaht = creditsDeducted * CREDITS_CONFIG.CREDIT_TO_BAHT_VALUE;
    const remainingBaht = priceBaht - discountBaht;

    await creditTransactionRepository.create({
      userId,
      amount: -creditsDeducted,
      type: TransactionType.DiscountApplied,
      description: `Applied ${creditsDeducted} credits as ฿${discountBaht} discount.`,
      referenceId: referenceId ?? null,
    });

    await creditWalletRepository.updateBalance(
      wallet.id,
      wallet.balance - creditsDeducted
    );

    return { creditsDeducted, discountBaht, remainingBaht };
  }
}

// Singleton instance for app usage
export const creditService = new CreditService();
