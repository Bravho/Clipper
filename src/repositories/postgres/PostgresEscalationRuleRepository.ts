import { IEscalationRuleRepository } from '@/repositories/interfaces/IEscalationRuleRepository';
import { EscalationRule } from '@/domain/models/EscalationRule';
import { pool } from '@/lib/db';

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  try { return JSON.parse(value as string) as T; } catch { return fallback; }
}

function rowToRule(row: Record<string, unknown>): EscalationRule {
  return {
    id: row.id as string,
    key: row.key as string,
    kind: row.kind as EscalationRule['kind'],
    appliesTo: (row.applies_to as string[]) ?? [],
    condition: parseJson(row.condition, { all: [] }),
    threshold: row.threshold != null ? Number(row.threshold) : null,
    reasonTh: row.reason_th as string,
    reasonEn: row.reason_en as string,
    priority: Number(row.priority ?? 100),
    enabled: Boolean(row.enabled),
    trustCanBypass: Boolean(row.trust_can_bypass),
    version: Number(row.version ?? 1),
    updatedBy: (row.updated_by as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export class PostgresEscalationRuleRepository implements IEscalationRuleRepository {
  constructor(private db = pool) {}

  async listEnabled(): Promise<EscalationRule[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM escalation_rules WHERE enabled = TRUE ORDER BY priority ASC'
    );
    return rows.map(rowToRule);
  }

  async findByKey(key: string): Promise<EscalationRule | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM escalation_rules WHERE key = $1', [key]
    );
    return rows[0] ? rowToRule(rows[0]) : null;
  }

  async upsert(rule: Omit<EscalationRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<EscalationRule> {
    const { rows } = await this.db.query(
      `INSERT INTO escalation_rules
         (key, kind, applies_to, condition, threshold, reason_th, reason_en,
          priority, enabled, trust_can_bypass, version, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (key) DO UPDATE SET
         kind             = EXCLUDED.kind,
         applies_to       = EXCLUDED.applies_to,
         condition        = EXCLUDED.condition,
         threshold        = EXCLUDED.threshold,
         reason_th        = EXCLUDED.reason_th,
         reason_en        = EXCLUDED.reason_en,
         priority         = EXCLUDED.priority,
         enabled          = EXCLUDED.enabled,
         trust_can_bypass = EXCLUDED.trust_can_bypass,
         version          = EXCLUDED.version + 1,
         updated_by       = EXCLUDED.updated_by,
         updated_at       = NOW()
       RETURNING *`,
      [
        rule.key,
        rule.kind,
        rule.appliesTo,
        JSON.stringify(rule.condition),
        rule.threshold ?? null,
        rule.reasonTh,
        rule.reasonEn,
        rule.priority,
        rule.enabled,
        rule.trustCanBypass,
        rule.version,
        rule.updatedBy ?? null,
      ]
    );
    return rowToRule(rows[0]);
  }
}
