import { evaluate, EvaluateInput, RuleTypeCfg } from '@/services/review/RuleEngine';
import { EscalationRule } from '@/domain/models/EscalationRule';

function makeTypeCfg(overrides: Partial<RuleTypeCfg> = {}): RuleTypeCfg {
  return {
    key: 'video',
    alwaysReview: false,
    defaultOutcome: 'review',
    confidenceThreshold: 0.8,
    ...overrides,
  };
}

function makeHardRule(key: string, overrides: Partial<EscalationRule> = {}): EscalationRule {
  return {
    id: crypto.randomUUID(),
    key,
    kind: 'hard',
    priority: 100,
    enabled: true,
    appliesTo: [],
    condition: { signal: key, op: 'exists', value: true },
    threshold: null,
    trustCanBypass: false,
    version: 1,
    reasonTh: 'เหตุผลทดสอบ',
    reasonEn: 'test reason',
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const BASE_INPUT: EvaluateInput = {
  typeKey: 'video',
  signals: {},
  confidence: 0.99,
  typeCfg: makeTypeCfg(),
  trust: null,
};

describe('RuleEngine.evaluate', () => {
  describe('hard rule wins over high confidence', () => {
    it('returns needs_review when hard rule matches even at confidence 0.99', () => {
      const rule = makeHardRule('bad_word', {
        condition: { signal: 'has_bad_word', op: 'eq', value: true },
      });
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { has_bad_word: true },
        confidence: 0.99,
      });
      expect(result.outcome).toBe('needs_review');
      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0].key).toBe('bad_word');
    });

    it('returns handoff_human for wants_human rule', () => {
      const rule = makeHardRule('wants_human', {
        condition: { signal: 'wants_human', op: 'exists', value: true },
      });
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { wants_human: true },
        confidence: 0.99,
      });
      expect(result.outcome).toBe('handoff_human');
    });

    it('returns handoff_human for customer_unhappy rule', () => {
      const rule = makeHardRule('customer_unhappy', {
        condition: { signal: 'customer_unhappy', op: 'exists', value: true },
      });
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { customer_unhappy: true },
        confidence: 0.99,
      });
      expect(result.outcome).toBe('handoff_human');
    });
  });

  describe('locked rule bypass prevention', () => {
    it('does NOT bypass wants_human even with trust.enabled + trustCanBypass=true', () => {
      const rule = makeHardRule('wants_human', {
        condition: { signal: 'wants_human', op: 'exists', value: true },
        trustCanBypass: true,
      });
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { wants_human: true },
        trust: {
          enabled: true,
          allowedTypes: ['video'],
          minConfidence: 0.8,
          sampleRate: 0.1,
        },
      });
      expect(result.outcome).toBe('handoff_human');
      expect(result.matchedRules.some((r) => r.key === 'wants_human')).toBe(true);
    });

    it('does NOT bypass out_of_package even with trust policy', () => {
      const rule = makeHardRule('out_of_package', {
        condition: { signal: 'out_of_package', op: 'exists', value: true },
        trustCanBypass: true,
      });
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { out_of_package: true },
        trust: { enabled: true, allowedTypes: ['video'], minConfidence: 0.7, sampleRate: 0.1 },
      });
      expect(result.outcome).toBe('needs_review');
      expect(result.matchedRules.some((r) => r.key === 'out_of_package')).toBe(true);
    });

    it('DOES bypass a non-locked hard rule when trust policy permits', () => {
      const rule = makeHardRule('soft_signal', {
        condition: { signal: 'soft', op: 'eq', value: true },
        trustCanBypass: true,
      });
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { soft: true },
        confidence: 0.95,
        typeCfg: makeTypeCfg({ defaultOutcome: 'auto' }),
        trust: { enabled: true, allowedTypes: ['video'], minConfidence: 0.9, sampleRate: 0 },
      });
      expect(result.outcome).toBe('auto_send');
    });
  });

  describe('sampling determinism', () => {
    it('produces consistent outcome for the same samplingId', () => {
      const typeCfg = makeTypeCfg({ defaultOutcome: 'auto' });
      const trust = { enabled: true, allowedTypes: ['video'], minConfidence: 0.7, sampleRate: 0.5 };
      const id = 'test-stable-id-abc-123';

      const r1 = evaluate([], { ...BASE_INPUT, typeCfg, trust, confidence: 0.9, samplingId: id });
      const r2 = evaluate([], { ...BASE_INPUT, typeCfg, trust, confidence: 0.9, samplingId: id });
      expect(r1.outcome).toBe(r2.outcome);
    });

    it('sampleRate=0 never samples trusted items', () => {
      const typeCfg = makeTypeCfg({ defaultOutcome: 'auto' });
      const trust = { enabled: true, allowedTypes: ['video'], minConfidence: 0.5, sampleRate: 0 };

      for (let i = 0; i < 20; i++) {
        const r = evaluate([], {
          ...BASE_INPUT, typeCfg, trust, confidence: 0.9,
          samplingId: `id-${i}`,
        });
        expect(r.outcome).toBe('auto_send');
      }
    });

    it('sampleRate=1 always samples trusted items', () => {
      const typeCfg = makeTypeCfg({ defaultOutcome: 'auto' });
      const trust = { enabled: true, allowedTypes: ['video'], minConfidence: 0.5, sampleRate: 1 };

      const r = evaluate([], {
        ...BASE_INPUT, typeCfg, trust, confidence: 0.9, samplingId: 'any-id',
      });
      expect(r.outcome).toBe('needs_review');
      expect(r.decisionMode).toBe('sampled');
    });
  });

  describe('confidence threshold', () => {
    it('escalates when confidence below threshold rule', () => {
      const rule: EscalationRule = {
        ...makeHardRule('low_conf'),
        kind: 'threshold',
        threshold: 0.75,
        condition: { signal: 'always_true', op: 'exists', value: true },
      };
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { always_true: true },
        confidence: 0.6,
        typeCfg: makeTypeCfg({ defaultOutcome: 'auto' }),
      });
      expect(result.outcome).toBe('needs_review');
    });

    it('does not escalate when confidence meets threshold', () => {
      const rule: EscalationRule = {
        ...makeHardRule('low_conf'),
        kind: 'threshold',
        threshold: 0.75,
        condition: { signal: 'always_true', op: 'exists', value: true },
      };
      const result = evaluate([rule], {
        ...BASE_INPUT,
        signals: { always_true: true },
        confidence: 0.8,
        typeCfg: makeTypeCfg({ defaultOutcome: 'auto' }),
        trust: null,
      });
      // No hard rules matched, no threshold escalation (conf >= 0.75), falls to default=auto
      expect(result.outcome).toBe('auto_send');
    });
  });

  describe('default outcomes', () => {
    it('returns auto_send when no rules match and defaultOutcome=auto', () => {
      const result = evaluate([], {
        ...BASE_INPUT,
        typeCfg: makeTypeCfg({ defaultOutcome: 'auto' }),
      });
      expect(result.outcome).toBe('auto_send');
    });

    it('returns needs_review when no rules match and defaultOutcome=review', () => {
      const result = evaluate([], {
        ...BASE_INPUT,
        typeCfg: makeTypeCfg({ defaultOutcome: 'review' }),
      });
      expect(result.outcome).toBe('needs_review');
    });
  });
});
