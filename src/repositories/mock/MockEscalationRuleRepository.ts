import { IEscalationRuleRepository } from '@/repositories/interfaces/IEscalationRuleRepository';
import { EscalationRule } from '@/domain/models/EscalationRule';

export class MockEscalationRuleRepository implements IEscalationRuleRepository {
  private store: Map<string, EscalationRule>;

  constructor(store?: Map<string, EscalationRule>) {
    this.store = store ?? new Map();
  }

  async listEnabled(): Promise<EscalationRule[]> {
    return [...this.store.values()]
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  async findByKey(key: string): Promise<EscalationRule | null> {
    for (const r of this.store.values()) {
      if (r.key === key) return { ...r };
    }
    return null;
  }

  async upsert(input: Omit<EscalationRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<EscalationRule> {
    for (const [id, r] of this.store.entries()) {
      if (r.key === input.key) {
        const updated = { ...r, ...input, updatedAt: new Date() };
        this.store.set(id, updated);
        return { ...updated };
      }
    }
    const now = new Date();
    const rule: EscalationRule = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(rule.id, rule);
    return { ...rule };
  }
}
