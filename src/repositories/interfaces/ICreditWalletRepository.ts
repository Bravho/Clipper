import { CreditWallet, CreateCreditWalletInput } from "@/domain/models/CreditWallet";

/**
 * Repository contract for CreditWallet persistence.
 *
 * TODO: PostgreSQL — implement PostgresCreditWalletRepository.
 *       Consider SELECT FOR UPDATE locking in deductCredits to
 *       prevent race conditions under concurrent requests.
 */
export interface ICreditWalletRepository {
  findByUserId(userId: string): Promise<CreditWallet | null>;
  create(input: CreateCreditWalletInput): Promise<CreditWallet>;
  updateBalance(walletId: string, newBalance: number): Promise<CreditWallet>;
  markInitialCreditsGranted(walletId: string): Promise<CreditWallet>;
}
