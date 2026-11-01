/**
 * ReviewOrder.test.ts
 *
 * Drives the real ReviewService + lineReviewGate (not a tautology over LINE_REVIEW_GATES).
 * Covers:
 *  1. Gate ordering: storyboard → voice → video with correct typeKeys
 *  2. Shop-skips-Tho: shop-reviewed gates → audience='shop'; others → 'admin'
 *  3. Revision becomes approvable again after edit → rerender → complete cycle
 *     (validates the captionedExport_9_16_assetId fix for findings 3 & 4)
 *  4. Non-LINE intake is ignored
 *  5. Duration + revision assertion helpers
 */
import { MockReviewItemRepository } from '@/repositories/mock/MockReviewItemRepository';
import { MockReviewActionRepository } from '@/repositories/mock/MockReviewActionRepository';
import { MockEscalationRuleRepository } from '@/repositories/mock/MockEscalationRuleRepository';
import { MockReviewOutboxRepository } from '@/repositories/mock/MockReviewOutboxRepository';
import { ReviewService } from '@/services/review/ReviewService';

process.env.REVIEW_SYSTEM_ENABLED = 'true';

// Shared mutable refs closed-over by jest.mock factories
let itemRepo: MockReviewItemRepository;
let actionRepo: MockReviewActionRepository;
let ruleRepo: MockEscalationRuleRepository;
let outboxRepo: MockReviewOutboxRepository;
let reviewSvc: ReviewService;

// Simple asset store for findById lookups in onLineReviewGate
const jobStore = new Map<string, import('@/domain/models/VideoGenerationJob').VideoGenerationJob>();
const assetStore = new Map<string, { id: string; storageKey: string; mimeType: string; [k: string]: unknown }>();

jest.mock('@/repositories', () => ({
  createReviewService: () => reviewSvc,
  get uploadedAssetRepository() {
    return {
      findByRequestId: jest.fn(async () => []),
      findById: (id: string) => Promise.resolve(assetStore.get(id) ?? null),
    };
  },
  get reviewItemRepository() { return itemRepo; },
  get videoGenerationJobRepository() {
    return { findById: async (id: string) => jobStore.get(id) ?? null,
      update: jest.fn(async (id: string, data: object) => {
        const job = { ...(jobStore.get(id) ?? {}), ...data }; jobStore.set(id, job as never); return job;
      }) };
  },
}));

jest.mock('@/lib/line/voiceReviewPreview', () => ({
  createVoiceReviewMp4: jest.fn(async () => 'voice-review.mp4'),
}));

const mockPipeline = {
  regenerateOverlayByRequester: jest.fn(async () => ({})),
  regenerateVoice: jest.fn(async () => ({})),
  approveContent: jest.fn(async () => ({})),
  approveVoiceConversionByRequester: jest.fn(async () => ({})),
  approveOverlayByRequester: jest.fn(async () => ({})),
};
jest.mock('@/services/VideoGenerationService', () => ({
  videoGenerationService: mockPipeline,
}));

jest.mock('@/lib/line/revisionContext', () => ({
  withReservedLineRevision: jest.fn(async (fn: () => Promise<void>) => fn()),
}));

import {
  onLineReviewGate,
  executeReviewDecision,
  gateAudience,
  LINE_REVIEW_GATES,
} from '@/services/review/lineReviewGate';
import { assertDurationAllowed, assertRevisionAllowed } from '@/services/review/ReviewService';

const makeRequest = (opts: { storyboard?: boolean; voice?: boolean } = {}) => ({
  id: 'req-1',
  userId: 'shop-user',
  intakeChannel: 'line' as const,
  shopReviewPreferences: { storyboard: opts.storyboard ?? false, voice: opts.voice ?? false },
  packageOrderId: 'order-1',
  revisionCount: 0,
} as never);

const makeJob = (step: string, overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  requestId: 'req-1',
  currentStep: step,
  processedVoiceAssetId: step === 'awaiting_voice_approval' ? 'voice-asset-1' : null,
  animatedVideoAssetId: null,
  captionedExport_9_16_assetId: step === 'awaiting_overlay_approval' ? 'captioned-asset-1' : null,
  captionedExport_16_9_assetId: null,
  captionedExport_1_1_assetId: null,
  captionedExport_4_5_assetId: null,
  approvedScriptThai: 'script',
  approvedStoryboard: 'board',
  scriptThai: null,
  storyboard: null,
  ...overrides,
} as never);

function seedAsset(id: string, mimeType = 'video/mp4') {
  assetStore.set(id, { id, storageKey: 'line_reviews/' + id, mimeType });
}

beforeEach(() => {
  itemRepo = new MockReviewItemRepository(new Map());
  actionRepo = new MockReviewActionRepository(new Map());
  ruleRepo = new MockEscalationRuleRepository(new Map());
  outboxRepo = new MockReviewOutboxRepository(new Map());
  reviewSvc = new ReviewService(itemRepo, actionRepo, ruleRepo, outboxRepo);
  assetStore.clear();
  jobStore.clear();
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Gate ordering
// ─────────────────────────────────────────────────────────────────────────────
test('production gate hook visits storyboard → voice → video and creates items with correct typeKeys', async () => {
  seedAsset('voice-asset-1');
  seedAsset('captioned-asset-1');
  const request = makeRequest();
  const advance = async (step: string) => {
    const job = makeJob(step); jobStore.set('job-1', job);
    await onLineReviewGate(request, job);
  };
  mockPipeline.approveContent.mockImplementationOnce(async () => { await advance('awaiting_voice_approval'); return {}; });
  mockPipeline.approveVoiceConversionByRequester.mockImplementationOnce(async () => { await advance('awaiting_overlay_approval'); return {}; });
  await advance('awaiting_content_approval');
  for (let i = 0; i < 3; i++) {
    const item = [...itemRepo['store'].values()].find(item => item.status === 'pending')!;
    await reviewSvc.decide({ itemId: item.id, expectedVersion: item.version, actorVia: 'web', decision: 'approve' });
    await executeReviewDecision(item.id);
  }
  expect(mockPipeline.approveOverlayByRequester).toHaveBeenCalled();
  const allItems = Array.from(itemRepo['store'].values());
  expect(allItems.map(i => i.typeKey)).toEqual(['script', 'tts', 'video']);
  expect(allItems.every(i => i.status === 'approved')).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Shop-skips-Tho
// ─────────────────────────────────────────────────────────────────────────────
test('shop-reviewed gates produce shop audience; un-reviewed video gate produces admin audience', async () => {
  seedAsset('voice-asset-1');
  seedAsset('captioned-asset-1');
  const request = makeRequest({ storyboard: true, voice: true });
  for (const step of LINE_REVIEW_GATES) {
    await onLineReviewGate(request, makeJob(step));
  }
  const items = Array.from(itemRepo['store'].values());
  const byType = Object.fromEntries(items.map(i => [i.typeKey, i.payload.audience]));
  expect(byType.script).toBe('shop');
  expect(byType.tts).toBe('shop');
  expect(byType.video).toBe('admin');
});

test('gateAudience helper returns correct audience for all gate combinations', () => {
  expect(gateAudience({ shopReviewPreferences: { storyboard: false } } as never, LINE_REVIEW_GATES[0])).toBe('admin');
  expect(gateAudience({ shopReviewPreferences: { storyboard: true } } as never, LINE_REVIEW_GATES[0])).toBe('shop');
  expect(gateAudience({ shopReviewPreferences: { voice: true } } as never, LINE_REVIEW_GATES[1])).toBe('shop');
  expect(gateAudience({ shopReviewPreferences: { voice: false } } as never, LINE_REVIEW_GATES[2])).toBe('admin');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Revision becomes approvable again after edit → rerender → complete
// ─────────────────────────────────────────────────────────────────────────────
test('edit+rerender then re-gate with new captioned asset replaces edited item as approvable pending', async () => {
  const ORIGINAL_ASSET = 'captioned-original';
  const NEW_ASSET = 'captioned-rerendered';
  seedAsset(ORIGINAL_ASSET);
  seedAsset(NEW_ASSET);
  const request = makeRequest();

  // Step 1: Initial gate — creates pending video review with original captioned asset
  await onLineReviewGate(request, makeJob('awaiting_overlay_approval', {
    captionedExport_9_16_assetId: ORIGINAL_ASSET,
  }));
  const originalItem = Array.from(itemRepo['store'].values())[0];
  expect(originalItem.typeKey).toBe('video');
  expect(originalItem.status).toBe('pending');
  expect(originalItem.renderState).toBe('none');
  expect(originalItem.assetRefs[0]?.asset_id).toBe(ORIGINAL_ASSET);

  // Step 2: Tho triggers an edit with rerender
  const editedItem = await reviewSvc.decide({
    itemId: originalItem.id,
    expectedVersion: originalItem.version,
    actorUserId: 'admin',
    actorVia: 'web',
    decision: 'edit',
    rerender: true,
  });
  expect(editedItem.status).toBe('edited');
  expect(editedItem.renderState).toBe('queued');

  // Step 3: Approval is blocked while rerender is queued
  await expect(reviewSvc.decide({
    itemId: editedItem.id,
    expectedVersion: editedItem.version,
    actorUserId: 'admin',
    actorVia: 'web',
    decision: 'approve',
  })).rejects.toMatchObject({ code: 'render_not_ready' });

  // Step 4: Rerender completes — pipeline calls onLineReviewGate with NEW captioned asset
  jobStore.set('job-1', makeJob('awaiting_overlay_approval'));
  // Mock only the renderer boundary; execute the real production decision dispatcher.
  mockPipeline.regenerateOverlayByRequester.mockImplementationOnce(async () => {
    const rendered = makeJob('awaiting_overlay_approval', { captionedExport_9_16_assetId: NEW_ASSET });
    jobStore.set('job-1', rendered);
    await onLineReviewGate(request, rendered);
    return {};
  });
  await executeReviewDecision(editedItem.id);
  expect(mockPipeline.regenerateOverlayByRequester).toHaveBeenCalledWith('job-1', 'shop-user');

  const finalItems = Array.from(itemRepo['store'].values());
  const expiredItem = finalItems.find(i => i.id === originalItem.id);
  const newItem = finalItems.find(i => i.id !== originalItem.id);

  // Old edited item is expired; new pending item has new asset and renderState=none
  expect(expiredItem?.status).toBe('expired');
  expect(newItem?.status).toBe('pending');
  expect(newItem?.renderState).toBe('none');
  expect(newItem?.assetRefs[0]?.asset_id).toBe(NEW_ASSET);

  // Step 5: New pending item can be approved without render_not_ready
  const approved = await reviewSvc.decide({
    itemId: newItem!.id,
    expectedVersion: newItem!.version,
    actorUserId: 'admin',
    actorVia: 'web',
    decision: 'approve',
  });
  expect(approved.status).toBe('approved');
  await executeReviewDecision(approved.id);
  expect(mockPipeline.approveOverlayByRequester).toHaveBeenCalledWith('job-1', 'shop-user');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Studio intake is ignored
// ─────────────────────────────────────────────────────────────────────────────
test('onLineReviewGate is a no-op for studio intake channel', async () => {
  const studioRequest = { id: 'req-1', userId: 'shop-user', intakeChannel: 'studio', shopReviewPreferences: {}, revisionCount: 0 } as never;
  await onLineReviewGate(studioRequest, makeJob('awaiting_overlay_approval'));
  expect(itemRepo['store'].size).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Duration and revision limits
// ─────────────────────────────────────────────────────────────────────────────
test('assertRevisionAllowed accepts count < MAX_REVISIONS and rejects at MAX_REVISIONS', () => {
  expect(() => assertRevisionAllowed(1)).not.toThrow();
  expect(() => assertRevisionAllowed(2)).toThrow('max_revisions');
});

test('assertDurationAllowed accepts boundary 90s and rejects invalid durations', () => {
  expect(() => assertDurationAllowed(90)).not.toThrow();
  for (const duration of [91, 0, -1, NaN, Infinity]) {
    expect(() => assertDurationAllowed(duration)).toThrow();
  }
});


test('successful regeneration reviews the regenerated script and storyboard', async () => {
  process.env.STORYBOARD_AI_PRECHECK_ENABLED = 'true';
  try {
    const job = makeJob('awaiting_content_approval', { id: 'regen-job', scriptThai: 'original', storyboard: '[]' });
    jobStore.set('regen-job', job);
    let calls = 0;
    await onLineReviewGate(makeRequest(), job, {
      callGeminiFn: async () => (++calls === 1 ? { pass: false, score: 0, issues: ['rewrite'] } : { pass: true, score: 100, issues: [] }),
      regenerateFn: async () => ({ scriptThai: 'regenerated', storyboard: '[]' }),
    });
    const item = [...itemRepo['store'].values()][0];
    expect(item.payload.script).toBe('regenerated');
    expect(item.payload.storyboard).toBe('[]');
    expect(item.signals.precheckIssues).toBeUndefined();
  } finally { delete process.env.STORYBOARD_AI_PRECHECK_ENABLED; }
});
