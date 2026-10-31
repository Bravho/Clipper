import { ReviewService, ReviewTypeConfig } from '@/services/review/ReviewService';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockReviewActionRepository } from '@/repositories/mock/MockReviewActionRepository';
import { MockEscalationRuleRepository } from '@/repositories/mock/MockEscalationRuleRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';

// Enable review system for tests
process.env.REVIEW_SYSTEM_ENABLED = 'true';

function makeService() {
  const itemRepo = new MockReviewItemRepository(new Map());
  const actionRepo = new MockReviewActionRepository(new Map());
  const ruleRepo = new MockEscalationRuleRepository(new Map());
  const outboxRepo = new MockReviewOutboxRepository(new Map());
  const svc = new ReviewService(itemRepo, actionRepo, ruleRepo, outboxRepo);
  return { svc, itemRepo, actionRepo, ruleRepo, outboxRepo };
}

const BASE_TYPE_CFG: ReviewTypeConfig = {
  key: 'video',
  alwaysReview: false,
  defaultOutcome: 'review',
  confidenceThreshold: 0.8,
  dueAfterMinutes: 60,
  expireAfterMinutes: 4320,
};

const BASE_INPUT = {
  typeKey: 'video',
  shopUserId: 'user-001',
  title: 'Test review',
  payload: { script: 'hello world' },
  signals: { has_price: false },
  confidence: 0.9,
  typeCfg: BASE_TYPE_CFG,
  trust: null,
};

describe('ReviewService', () => {
  describe('createItem', () => {
    it('creates a pending item', async () => {
      const { svc } = makeService();
      const { item, created } = await svc.createItem(BASE_INPUT);
      expect(created).toBe(true);
      expect(item.status).toBe('pending');
      expect(item.typeKey).toBe('video');
    });

    it('idempotent: same idempotencyKey returns existing item', async () => {
      const { svc } = makeService();
      const key = 'idem-key-001';
      const { item: first } = await svc.createItem({ ...BASE_INPUT, idempotencyKey: key });
      const { item: second, created } = await svc.createItem({ ...BASE_INPUT, idempotencyKey: key });
      expect(created).toBe(false);
      expect(second.id).toBe(first.id);
    });

    it('duplicate job+gate returns one item', async () => {
      const { svc } = makeService();
      const jobId = 'job-abc';
      const gateStep = 'AwaitingContentApproval';
      const { item: a } = await svc.createItem({ ...BASE_INPUT, jobId, gateStep });
      const { item: b, created } = await svc.createItem({ ...BASE_INPUT, jobId, gateStep });
      expect(created).toBe(false);
      expect(b.id).toBe(a.id);
    });

    it('auto-approves when no rules and defaultOutcome=auto', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem({
        ...BASE_INPUT,
        typeCfg: { ...BASE_TYPE_CFG, defaultOutcome: 'auto' },
      });
      expect(item.status).toBe('approved');
      expect(item.decidedVia).toBe('auto');
    });
  });

  describe('decide', () => {
    it('approves a pending item', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem(BASE_INPUT);
      const approved = await svc.decide({
        itemId: item.id,
        expectedVersion: item.version,
        actorVia: 'web',
        actorUserId: 'staff-1',
        decision: 'approve',
      });
      expect(approved.status).toBe('approved');
    });

    it('rejects a pending item', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem(BASE_INPUT);
      const rejected = await svc.decide({
        itemId: item.id,
        expectedVersion: item.version,
        actorVia: 'web',
        decision: 'reject',
        reasonText: 'price wrong',
      });
      expect(rejected.status).toBe('rejected');
    });

    it('throws version_conflict on stale version', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem(BASE_INPUT);
      await expect(
        svc.decide({
          itemId: item.id,
          expectedVersion: item.version + 1,
          actorVia: 'web',
          decision: 'approve',
        })
      ).rejects.toMatchObject({ code: 'version_conflict' });
    });

    it('throws not_found for missing item', async () => {
      const { svc } = makeService();
      await expect(
        svc.decide({ itemId: 'not-exist', expectedVersion: 1, actorVia: 'web', decision: 'approve' })
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('throws item_not_pending for already-approved item', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem(BASE_INPUT);
      await svc.decide({ itemId: item.id, expectedVersion: item.version, actorVia: 'web', decision: 'approve' });
      const fresh = await svc.findById(item.id);
      await expect(
        svc.decide({ itemId: item.id, expectedVersion: fresh!.version, actorVia: 'web', decision: 'approve' })
      ).rejects.toMatchObject({ code: 'item_not_pending' });
    });
  });

  describe('expireItem', () => {
    it('moves a pending item to expired', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem(BASE_INPUT);
      await svc.expireItem(item.id);
      const expired = await svc.findById(item.id);
      expect(expired?.status).toBe('expired');
    });

    it('no-ops on already-approved item', async () => {
      const { svc } = makeService();
      const { item } = await svc.createItem(BASE_INPUT);
      await svc.decide({ itemId: item.id, expectedVersion: item.version, actorVia: 'web', decision: 'approve' });
      await svc.expireItem(item.id);
      const still = await svc.findById(item.id);
      expect(still?.status).toBe('approved');
    });
  });

  describe('feature flag', () => {
    it('throws when REVIEW_SYSTEM_ENABLED is false', async () => {
      process.env.REVIEW_SYSTEM_ENABLED = 'false';
      const { svc } = makeService();
      await expect(svc.createItem(BASE_INPUT)).rejects.toThrow('not enabled');
      process.env.REVIEW_SYSTEM_ENABLED = 'true';
    });
  });
});
