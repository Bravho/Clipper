import { ITermsAcceptanceRepository } from "@/repositories/interfaces/ITermsAcceptanceRepository";
import {
  TermsAcceptance,
  CreateTermsAcceptanceInput,
} from "@/domain/models/TermsAcceptance";
import { PolicyType } from "@/domain/enums/PolicyType";
import { SEED_ACCEPTANCES } from "@/seed/mockData";

// TODO: PostgreSQL — replace with PostgresTermsAcceptanceRepository

declare global {
  // eslint-disable-next-line no-var
  var __mockAcceptanceStore: Map<string, TermsAcceptance> | undefined;
}

function getStore(): Map<string, TermsAcceptance> {
  if (!global.__mockAcceptanceStore) {
    global.__mockAcceptanceStore = new Map();
    SEED_ACCEPTANCES.forEach((a) =>
      global.__mockAcceptanceStore!.set(a.id, { ...a })
    );
  }
  return global.__mockAcceptanceStore;
}

export class MockTermsAcceptanceRepository
  implements ITermsAcceptanceRepository
{
  private store: Map<string, TermsAcceptance>;

  constructor(store?: Map<string, TermsAcceptance>) {
    this.store = store ?? getStore();
  }

  async findByUserId(userId: string): Promise<TermsAcceptance[]> {
    return [...this.store.values()]
      .filter((a) => a.userId === userId)
      .map((a) => ({ ...a }));
  }

  async findLatestByUserIdAndType(
    userId: string,
    policyType: PolicyType
  ): Promise<TermsAcceptance | null> {
    const matches = [...this.store.values()]
      .filter((a) => a.userId === userId && a.policyType === policyType)
      .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
    return matches[0] ? { ...matches[0] } : null;
  }

  async create(input: CreateTermsAcceptanceInput): Promise<TermsAcceptance> {
    const acceptance: TermsAcceptance = {
      ...input,
      id: crypto.randomUUID(),
      acceptedAt: new Date(),
    };
    this.store.set(acceptance.id, acceptance);
    return { ...acceptance };
  }
}
