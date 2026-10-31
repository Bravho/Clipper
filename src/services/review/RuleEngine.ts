/**
 * RuleEngine — pure function, no I/O.
 *
 * Decision order (DESIGN §5.1):
 * 1. Hard rules (any match → escalate, regardless of confidence or trust)
 * 2. Locked hard rules cannot be bypassed even for trusted shops
 * 3. type.always_review → escalate
 * 4. Trusted shop + auto-approve enabled → sample check
 * 5. confidence < threshold → escalate
 * 6. type.default_outcome → use default
 */

import { EscalationRule } from '@/domain/models/EscalationRule';
import { MatchedRule, ReviewDecisionMode } from '@/domain/models/ReviewItem';
import { LOCKED_RULE_KEYS } from '@/config/reviewSystem';
import { evalCondition } from './ruleDsl';

export interface RuleTypeCfg {
  key: string;
  alwaysReview: boolean;
  defaultOutcome: 'review' | 'auto';
  confidenceThreshold: number;
}

export interface TrustPolicy {
  enabled: boolean;
  allowedTypes: string[];
  minConfidence: number;
  sampleRate: number;
}

export interface EvaluateInput {
  typeKey: string;
  signals: Record<string, unknown>;
  confidence?: number;
  typeCfg: RuleTypeCfg;
  trust?: TrustPolicy | null;
  /** Deterministic item ID for sampling hash (use item_id or idempotency key). */
  samplingId?: string;
}

export type EvaluateOutcome = 'needs_review' | 'auto_send' | 'handoff_human';

export interface EvaluateResult {
  outcome: EvaluateOutcome;
  decisionMode: ReviewDecisionMode;
  matchedRules: MatchedRule[];
  trace: string[];
}

/** Deterministic sampling: hash(id) mod 10000 < rate*10000. */
function isSampled(id: string, sampleRate: number): boolean {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 10000 < sampleRate * 10000;
}

function ruleAppliesToType(rule: EscalationRule, typeKey: string): boolean {
  return rule.appliesTo.length === 0 || rule.appliesTo.includes(typeKey);
}

export function evaluate(
  rules: EscalationRule[],
  input: EvaluateInput
): EvaluateResult {
  const { typeKey, signals, confidence, typeCfg, trust, samplingId } = input;
  const trace: string[] = [];
  const matchedRules: MatchedRule[] = [];

  const enabled = rules.filter((r) => r.enabled && ruleAppliesToType(r, typeKey));

  // ── 1. Hard rules ──────────────────────────────────────────────────────────
  const hardRules = enabled.filter((r) => r.kind === 'hard');
  for (const rule of hardRules.sort((a, b) => a.priority - b.priority)) {
    const matched = evalCondition(rule.condition, signals);
    if (!matched) continue;

    const locked = LOCKED_RULE_KEYS.has(rule.key as never);
    const isTrustedBypass = !locked && rule.trustCanBypass && trust?.enabled;

    if (!isTrustedBypass) {
      trace.push(`hard rule matched: ${rule.key}`);
      matchedRules.push({
        key: rule.key,
        kind: 'hard',
        version: rule.version,
        reason_th: rule.reasonTh,
        reason_en: rule.reasonEn,
      });
    } else {
      trace.push(`hard rule ${rule.key} bypassed by trust policy`);
    }
  }

  if (matchedRules.some((r) => r.kind === 'hard')) {
    const isHuman =
      matchedRules.some((r) => r.key === 'wants_human') ||
      matchedRules.some((r) => r.key === 'customer_unhappy');
    return {
      outcome: isHuman ? 'handoff_human' : 'needs_review',
      decisionMode: 'review',
      matchedRules,
      trace,
    };
  }

  // ── 2. always_review on type ───────────────────────────────────────────────
  if (typeCfg.alwaysReview) {
    trace.push('type.always_review');
    return {
      outcome: 'needs_review',
      decisionMode: 'review',
      matchedRules,
      trace,
    };
  }

  // ── 3. Threshold rules ─────────────────────────────────────────────────────
  const thresholdRules = enabled.filter((r) => r.kind === 'threshold');
  for (const rule of thresholdRules) {
    if (rule.threshold == null) continue;
    const conditionHolds = evalCondition(rule.condition, signals);
    if (!conditionHolds) continue;
    const conf = confidence ?? (signals['confidence'] as number | undefined);
    if (conf !== undefined && conf < rule.threshold) {
      trace.push(`threshold rule ${rule.key}: confidence ${conf} < ${rule.threshold}`);
      matchedRules.push({
        key: rule.key,
        kind: 'threshold',
        version: rule.version,
        reason_th: rule.reasonTh,
        reason_en: rule.reasonEn,
      });
    }
  }

  if (matchedRules.some((r) => r.kind === 'threshold')) {
    return {
      outcome: 'needs_review',
      decisionMode: 'review',
      matchedRules,
      trace,
    };
  }

  // ── 4. Trusted shop path ───────────────────────────────────────────────────
  const effectiveConfidence = confidence ?? (signals['confidence'] as number | undefined);
  if (effectiveConfidence !== undefined && effectiveConfidence < typeCfg.confidenceThreshold) {
    return { outcome: 'needs_review', decisionMode: 'review', matchedRules,
      trace: [...trace, 'type.confidenceThreshold not met'] };
  }
  if (trust?.enabled && trust.allowedTypes.includes(typeKey)) {
    const conf = confidence ?? (signals['confidence'] as number | undefined);
    const minConf = trust.minConfidence;
    if (conf !== undefined && conf < minConf) {
      trace.push(`trust min_confidence not met: ${conf} < ${minConf}`);
      return {
        outcome: 'needs_review',
        decisionMode: 'review',
        matchedRules,
        trace,
      };
    }

    const id = samplingId ?? 'unknown';
    if (isSampled(id, trust.sampleRate)) {
      trace.push(`sampling triggered (rate=${trust.sampleRate}, id=${id})`);
      matchedRules.push({
        key: 'sampling',
        kind: 'sampling',
        version: 1,
        reason_th: 'สุ่มตรวจคุณภาพ',
        reason_en: 'Random quality sample',
      });
      return {
        outcome: 'needs_review',
        decisionMode: 'sampled',
        matchedRules,
        trace,
      };
    }

    trace.push('trusted shop auto-approve');
    return {
      outcome: 'auto_send',
      decisionMode: 'auto',
      matchedRules,
      trace,
    };
  }

  // ── 5. type.default_outcome ────────────────────────────────────────────────
  trace.push(`type.default_outcome=${typeCfg.defaultOutcome}`);
  if (typeCfg.defaultOutcome === 'auto') {
    return {
      outcome: 'auto_send',
      decisionMode: 'auto',
      matchedRules,
      trace,
    };
  }

  return {
    outcome: 'needs_review',
    decisionMode: 'review',
    matchedRules,
    trace,
  };
}
