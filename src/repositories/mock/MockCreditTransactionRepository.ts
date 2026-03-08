import { ICreditTransactionRepository } from "@/repositories/interfaces/ICreditTransactionRepository";
import {
  CreditTransaction,
  CreateCreditTransactionInput,
} from "@/domain/models/CreditTransaction";
import { SEED_TRANSACTIONS } from "@/seed/mockData";

// TODO: PostgreSQL — replace with PostgresCreditTransactionRepository

declare global {
  // eslint-disable-next-line no-var
  var __mockTransactionStore: Map<string, CreditTransaction> | undefined;
}

function getStore(): Map<string, CreditTransaction> {
  if (!global.__mockTransactionStore) {
    global.__mockTransactionStore = new Map();
    SEED_TRANSACTIONS.forEach((t) =>
      global.__mockTransactionStore!.set(t.id, { ...t })
    );
  }
  return global.__mockTransactionStore;
}

export class MockCreditTransactionRepository
  implements ICreditTransactionRepository
{
  private store: Map<string, CreditTransaction>;

  constructor(store?: Map<string, CreditTransaction>) {
    this.store = store ?? getStore();
  }

  async findByUserId(userId: string): Promise<CreditTransaction[]> {
    return [...this.store.values()]
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(input: CreateCreditTransactionInput): Promise<CreditTransaction> {
    const transaction: CreditTransaction = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.store.set(transaction.id, transaction);
    return { ...transaction };
  }
}
