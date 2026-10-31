export type RuleKind = 'hard' | 'threshold' | 'sampling';

/** Condition DSL node. */
export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | RuleLeaf;

export interface RuleLeaf {
  signal: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains_any' | 'regex' | 'exists';
  value: unknown;
}

export interface EscalationRule {
  id: string;
  key: string;
  kind: RuleKind;
  appliesTo: string[];
  condition: RuleCondition;
  threshold: number | null;
  reasonTh: string;
  reasonEn: string;
  priority: number;
  enabled: boolean;
  trustCanBypass: boolean;
  version: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
