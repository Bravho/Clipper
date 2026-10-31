/**
 * Rule DSL evaluator.
 *
 * Pure function — no I/O, no side effects. Safe to unit-test without a DB.
 * No eval() — all operators are explicit code.
 */

import { z } from 'zod';
import { RuleCondition, RuleLeaf } from '@/domain/models/EscalationRule';
import { MAX_RULE_REGEX_LENGTH } from '@/config/reviewSystem';

// ── Zod schema for the DSL ───────────────────────────────────────────────────

const leafSchema: z.ZodType<RuleLeaf> = z.object({
  signal: z.string().min(1).max(100),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains_any', 'regex', 'exists']),
  value: z.unknown(),
}) as unknown as z.ZodType<RuleLeaf>;

// Forward reference for recursive type
const conditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema) }),
    z.object({ any: z.array(conditionSchema) }),
    z.object({ not: conditionSchema }),
    leafSchema,
  ])
);

export const ruleConditionSchema = conditionSchema;

/** Validate a condition DSL value (throws ZodError on failure). */
export function parseCondition(raw: unknown): RuleCondition {
  return ruleConditionSchema.parse(raw);
}

// ── Signal resolution ────────────────────────────────────────────────────────

/**
 * Resolve a dot-notated signal path from the signals bag.
 * e.g. "shop.completed_jobs" → signals["shop"]["completed_jobs"]
 */
function resolveSignal(signals: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = signals;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ── Operator evaluation ──────────────────────────────────────────────────────

function evalLeaf(leaf: RuleLeaf, signals: Record<string, unknown>): boolean {
  const val = resolveSignal(signals, leaf.signal);

  switch (leaf.op) {
    case 'exists':
      return leaf.value === true ? val !== undefined && val !== null : val === undefined || val === null;

    case 'eq':
      return val === leaf.value;

    case 'neq':
      return val !== leaf.value;

    case 'gt':
      return typeof val === 'number' && typeof leaf.value === 'number' && val > leaf.value;

    case 'gte':
      return typeof val === 'number' && typeof leaf.value === 'number' && val >= leaf.value;

    case 'lt':
      return typeof val === 'number' && typeof leaf.value === 'number' && val < leaf.value;

    case 'lte':
      return typeof val === 'number' && typeof leaf.value === 'number' && val <= leaf.value;

    case 'in':
      return Array.isArray(leaf.value) && leaf.value.includes(val);

    case 'contains_any': {
      if (!Array.isArray(leaf.value)) return false;
      if (Array.isArray(val)) {
        return leaf.value.some((v) => (val as unknown[]).includes(v));
      }
      if (typeof val === 'string') {
        return leaf.value.some((v) => typeof v === 'string' && val.includes(v));
      }
      return false;
    }

    case 'regex': {
      if (typeof leaf.value !== 'string') return false;
      if (leaf.value.length > MAX_RULE_REGEX_LENGTH) return false;
      if (typeof val !== 'string') return false;
      try {
        return new RegExp(leaf.value, 'u').test(val);
      } catch {
        return false;
      }
    }

    default:
      return false;
  }
}

/** Evaluate a condition DSL node against a signals bag. */
export function evalCondition(
  condition: RuleCondition,
  signals: Record<string, unknown>
): boolean {
  if ('all' in condition) {
    return condition.all.every((c) => evalCondition(c, signals));
  }
  if ('any' in condition) {
    return condition.any.some((c) => evalCondition(c, signals));
  }
  if ('not' in condition) {
    return !evalCondition(condition.not, signals);
  }
  return evalLeaf(condition as RuleLeaf, signals);
}
