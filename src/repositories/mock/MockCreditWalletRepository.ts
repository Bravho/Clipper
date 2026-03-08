import { ICreditWalletRepository } from "@/repositories/interfaces/ICreditWalletRepository";
import { CreditWallet, CreateCreditWalletInput } from "@/domain/models/CreditWallet";
import { SEED_WALLETS } from "@/seed/mockData";

// TODO: PostgreSQL — replace with PostgresCreditWalletRepository

declare global {
  // eslint-disable-next-line no-var
  var __mockWalletStore: Map<string, CreditWallet> | undefined;
}

function getStore(): Map<string, CreditWallet> {
  if (!global.__mockWalletStore) {
    global.__mockWalletStore = new Map();
    SEED_WALLETS.forEach((w) =>
      global.__mockWalletStore!.set(w.id, { ...w })
    );
  }
  return global.__mockWalletStore;
}

export class MockCreditWalletRepository implements ICreditWalletRepository {
  private store: Map<string, CreditWallet>;

  constructor(store?: Map<string, CreditWallet>) {
    this.store = store ?? getStore();
  }

  async findByUserId(userId: string): Promise<CreditWallet | null> {
    for (const wallet of this.store.values()) {
      if (wallet.userId === userId) return { ...wallet };
    }
    return null;
  }

  async create(input: CreateCreditWalletInput): Promise<CreditWallet> {
    const wallet: CreditWallet = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(wallet.id, wallet);
    return { ...wallet };
  }

  async updateBalance(walletId: string, newBalance: number): Promise<CreditWallet> {
    const existing = this.store.get(walletId);
    if (!existing) throw new Error(`Wallet not found: ${walletId}`);
    const updated: CreditWallet = {
      ...existing,
      balance: newBalance,
      updatedAt: new Date(),
    };
    this.store.set(walletId, updated);
    return { ...updated };
  }

  async markInitialCreditsGranted(walletId: string): Promise<CreditWallet> {
    const existing = this.store.get(walletId);
    if (!existing) throw new Error(`Wallet not found: ${walletId}`);
    const updated: CreditWallet = {
      ...existing,
      initialCreditsGranted: true,
      updatedAt: new Date(),
    };
    this.store.set(walletId, updated);
    return { ...updated };
  }
}
