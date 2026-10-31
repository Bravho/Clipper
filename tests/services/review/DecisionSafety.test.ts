jest.mock('@/lib/db', () => ({ pool: {} }));
import { ReviewService, getDefaultTypeCfg } from '@/services/review/ReviewService';
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockReviewActionRepository } from '@/repositories/mock/MockReviewActionRepository';
import { MockEscalationRuleRepository } from '@/repositories/mock/MockEscalationRuleRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { PostgresReviewItemRepository } from '@/repositories/postgres/PostgresReviewItemRepository';
import { evaluate } from '@/services/review/RuleEngine';
process.env.REVIEW_SYSTEM_ENABLED = 'true';
function setup() {
  const items = new MockReviewItemRepository(new Map());
  const actions = new MockReviewActionRepository(new Map());
  const outbox = new MockReviewOutboxRepository(new Map());
  return { items, actions, outbox, service: new ReviewService(items, actions, new MockEscalationRuleRepository(new Map()), outbox) };
}
test('competing service decisions produce one winner and one decision audit/outbox', async () => {
  const { service, actions, outbox } = setup();
  const { item } = await service.createItem({ typeKey: 'video', shopUserId: 'u', title: 'test', payload: {}, signals: {}, typeCfg: getDefaultTypeCfg('video') });
  const results = await Promise.allSettled(['approve','reject'].map(decision => service.decide({ itemId: item.id, expectedVersion: 1, decision: decision as 'approve' | 'reject', actorVia: 'web' })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('version_conflict');
  expect((await actions.listByItem(item.id)).filter(a => ['approved','rejected'].includes(a.action))).toHaveLength(1);
  expect((await outbox.claimNext())?.eventType).toBe('review.created');
  expect((await outbox.claimNext())?.eventType).toBe('review.decided');
  expect(await outbox.claimNext()).toBeNull();
});
test.each(['queued','rendering','failed','expired'])('service rejects unsafe state %s', async state => {
  const { service, items } = setup();
  const { item } = await service.createItem({ typeKey: 'video', shopUserId: 'u', title: 'test', payload: {}, signals: {}, typeCfg: getDefaultTypeCfg('video') });
  await items.update(item.id, state === 'expired' ? { expiresAt: new Date(0) } : { renderState: state as 'queued' });
  await expect(service.decide({ itemId: item.id, expectedVersion: 1, decision: 'approve', actorVia: 'web' })).rejects.toThrow();
});
test('real Postgres decision update conditions on status and version and reports lost race', async () => {
  const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
  const repo = new PostgresReviewItemRepository({ query } as never);
  await expect(repo.update('i', { status: 'approved' }, { expectedVersion: 2, expectedStatus: 'pending' })).rejects.toMatchObject({ code: 'version_conflict' });
  expect(query.mock.calls[0][0]).toContain('AND version = $3 AND status = $4 AND expires_at > NOW()');
});
test('type confidence threshold applies even to trusted auto mode without rules', () => {
  expect(evaluate([], { typeKey: 'video', signals: {}, confidence: 0.2,
    typeCfg: { key: 'video', alwaysReview: false, defaultOutcome: 'auto', confidenceThreshold: 0.8 },
    trust: { enabled: true, allowedTypes: ['video'], minConfidence: 0.1, sampleRate: 0 } }).outcome).toBe('needs_review');
});
