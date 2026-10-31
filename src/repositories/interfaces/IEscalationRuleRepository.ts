import { EscalationRule } from '@/domain/models/EscalationRule';

export interface IEscalationRuleRepository {
  listEnabled(): Promise<EscalationRule[]>;
  findByKey(key: string): Promise<EscalationRule | null>;
  upsert(rule: Omit<EscalationRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<EscalationRule>;
}
