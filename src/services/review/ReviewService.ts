/**
 * ReviewService — review item state machine and lifecycle.
 *
 * All repositories are injected so tests can use Map-based mocks.
 * This service writes action log + outbox entries atomically
 * (mock: in-memory; postgres: conditional UPDATE + version bump).
 */

import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import { IReviewActionRepository } from '@/repositories/interfaces/IReviewActionRepository';
import { IEscalationRuleRepository } from '@/repositories/interfaces/IEscalationRuleRepository';
import { IReviewOutboxRepository } from '@/repositories/interfaces/IReviewOutboxRepository';
import {
  ReviewItem,
  CreateReviewItemInput,
  ReviewDecisionMode,
  ReviewDecidedVia,
} from '@/domain/models/ReviewItem';
import { ReviewReasonCode, DiffEntry } from '@/domain/models/ReviewAction';
import { evaluate, EvaluateInput, RuleTypeCfg, TrustPolicy } from './RuleEngine';
import { generateShortCode } from '@/config/reviewSystem';
import {
  isReviewSystemEnabled,
  MAX_REVISIONS_PER_CLIP,
  MAX_CLIP_DURATION_SECONDS,
} from '@/config/reviewSystem';

export interface ReviewTypeConfig {
  key: string;
  alwaysReview: boolean;
  defaultOutcome: 'review' | 'auto';
  confidenceThreshold: number;
  dueAfterMinutes: number;
  expireAfterMinutes: number;
}

export interface CreateReviewInput {
  typeKey: string;
  shopUserId: string;
  requestId?: string;
  jobId?: string;
  gateStep?: string;
  packageOrderId?: string;
  externalRef?: string;
  title: string;
  payload: Record<string, unknown>;
  signals: Record<string, unknown>;
  confidence?: number;
  producer?: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string;
  assetRefs?: CreateReviewItemInput['assetRefs'];
  typeCfg: ReviewTypeConfig;
  trust?: TrustPolicy | null;
}

export interface DecideInput {
  itemId: string;
  expectedVersion: number;
  actorUserId?: string;
  actorVia: ReviewDecidedVia;
  decision: 'approve' | 'reject' | 'edit' | 'manual_reply';
  reasonCode?: ReviewReasonCode;
  reasonText?: string;
  edits?: DiffEntry[];
  rerender?: boolean;
  replyText?: string;
  clientElapsedMs?: number;
}

// Default type configs (mirrors DB seed)
const DEFAULT_TYPE_CONFIGS: Record<string, ReviewTypeConfig> = {
  video:          { key: 'video',          alwaysReview: false, defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
  tts:            { key: 'tts',            alwaysReview: false, defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
  script:         { key: 'script',         alwaysReview: false, defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
  caption:        { key: 'caption',        alwaysReview: false, defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
  customer_reply: { key: 'customer_reply', alwaysReview: false, defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
  out_of_package: { key: 'out_of_package', alwaysReview: true,  defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
  complaint:      { key: 'complaint',      alwaysReview: true,  defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 300,  expireAfterMinutes: 4320 },
  footage_qc:     { key: 'footage_qc',     alwaysReview: false, defaultOutcome: 'review', confidenceThreshold: 0.8, dueAfterMinutes: 1440, expireAfterMinutes: 4320 },
};

export function getDefaultTypeCfg(typeKey: string): ReviewTypeConfig {
  return DEFAULT_TYPE_CONFIGS[typeKey] ?? DEFAULT_TYPE_CONFIGS['video'];
}

export class ReviewService {
  constructor(
    private reviewItemRepo: IReviewItemRepository,
    private actionRepo: IReviewActionRepository,
    private ruleRepo: IEscalationRuleRepository,
    private outboxRepo: IReviewOutboxRepository,
    private transaction?: <T>(work: (service: ReviewService) => Promise<T>) => Promise<T>,
    private reserveRevision?: (requestId: string) => Promise<void>
  ) {}

  /**
   * Evaluate whether a review item needs review without persisting anything.
   * Applies typeCfg.confidenceThreshold in the evaluation.
   */
  async evaluate(input: Omit<CreateReviewInput, 'title' | 'payload'>) {
    const rules = await this.ruleRepo.listEnabled();
    const typeCfg: RuleTypeCfg = {
      key: input.typeCfg.key,
      alwaysReview: input.typeCfg.alwaysReview,
      defaultOutcome: input.typeCfg.defaultOutcome,
      confidenceThreshold: input.typeCfg.confidenceThreshold,
    };
    return evaluate(rules, {
      typeKey: input.typeKey,
      signals: input.signals,
      confidence: input.confidence,
      typeCfg,
      trust: input.trust,
    });
  }

  /**
   * Create a new review item. Idempotent if idempotencyKey matches an existing item.
   * Returns the item and whether it was newly created.
   */
  async createItem(input: CreateReviewInput): Promise<{ item: ReviewItem; created: boolean }> {
    if (!isReviewSystemEnabled()) {
      throw new Error('Review system is not enabled (REVIEW_SYSTEM_ENABLED)');
    }

    // Idempotency check
    if (input.idempotencyKey) {
      const existing = await this.reviewItemRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return { item: existing, created: false };
    }

    // Deduplicate: at most one open item per job+gate
    if (input.jobId && input.gateStep) {
      const existing = await this.reviewItemRepo.findOpenByJobGate(input.jobId, input.gateStep);
      if (existing) return { item: existing, created: false };
    }

    const rules = await this.ruleRepo.listEnabled();
    const typeCfg: RuleTypeCfg = {
      key: input.typeCfg.key,
      alwaysReview: input.typeCfg.alwaysReview,
      defaultOutcome: input.typeCfg.defaultOutcome,
      confidenceThreshold: input.typeCfg.confidenceThreshold,
    };

    // Apply confidence threshold: if confidence < typeCfg.confidenceThreshold, escalate
    const confSignals = { ...input.signals };
    if (input.confidence !== undefined) {
      confSignals['confidence'] = input.confidence;
    }

    const result = evaluate(rules, {
      typeKey: input.typeKey,
      signals: confSignals,
      confidence: input.confidence,
      typeCfg,
      trust: input.trust,
      samplingId: input.idempotencyKey,
    });

    const now = new Date();
    const dueAt = new Date(now.getTime() + input.typeCfg.dueAfterMinutes * 60_000);
    const expiresAt = new Date(now.getTime() + input.typeCfg.expireAfterMinutes * 60_000);

    const itemInput: CreateReviewItemInput = {
      typeKey: input.typeKey,
      shopUserId: input.shopUserId,
      requestId: input.requestId,
      jobId: input.jobId,
      gateStep: input.gateStep,
      packageOrderId: input.packageOrderId,
      externalRef: input.externalRef,
      title: input.title,
      payload: input.payload,
      decisionMode: result.decisionMode,
      matchedRules: result.matchedRules,
      ruleSnapshot: { trace: result.trace, signals: input.signals },
      signals: confSignals,
      confidence: input.confidence,
      producer: input.producer as CreateReviewItemInput['producer'],
      priority: input.priority,
      dueAt,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
      assetRefs: input.assetRefs,
    };

    let item = await this.reviewItemRepo.create(itemInput);

    // Auto-approve
    if (result.outcome === 'auto_send') {
      item = await this.reviewItemRepo.update(item.id, {
        status: 'approved',
        resolution: 'auto_approved',
        decidedVia: 'auto',
        decidedAt: now,
      });
      await this.actionRepo.create({
        reviewItemId: item.id,
        itemVersion: 1,
        action: 'auto_approved',
        actorVia: 'auto',
        fromStatus: 'pending',
        toStatus: 'approved',
      });
    } else {
      await this.actionRepo.create({
        reviewItemId: item.id,
        itemVersion: 1,
        action: 'created',
        actorVia: 'auto',
        fromStatus: undefined,
        toStatus: 'pending',
      });
      // Enqueue outbox notification
      await this.outboxRepo.enqueue({
        eventType: 'review.created',
        reviewItemId: item.id,
        payload: { item_id: item.id, short_code: item.shortCode, type: item.typeKey },
      });
    }

    return { item, created: true };
  }

  /** Record that the item was opened (for decision_seconds calculation). */
  async recordOpened(itemId: string, actorUserId?: string): Promise<void> {
    const item = await this.reviewItemRepo.findById(itemId);
    if (!item || item.firstOpenedAt) return;
    await this.reviewItemRepo.update(itemId, { firstOpenedAt: new Date() });
    await this.actionRepo.create({
      reviewItemId: itemId,
      itemVersion: item.version,
      action: 'opened',
      actorUserId,
      actorVia: 'web',
    });
  }

  /**
   * Apply a decision (approve/reject/edit/manual_reply).
   *
   * Atomic guarantee: uses expectedVersion to do a conditional UPDATE.
   * If another writer changed the item between our read and write, the
   * Postgres implementation returns version_conflict.
   *
   * Rejects expired items and video items whose render is not ready.
   */
  async decide(input: DecideInput): Promise<ReviewItem> {
    if (this.transaction) return this.transaction(service => service.decide(input));
    const item = await this.reviewItemRepo.findById(input.itemId);
    if (!item) throw Object.assign(new Error('not_found'), { code: 'not_found' });

    // Reject decisions on expired items (Item 15)
    if (item.status === 'expired' || item.expiresAt.getTime() <= Date.now()) {
      throw Object.assign(new Error('item_expired'), { code: 'item_expired' });
    }

    if (item.status !== 'pending' && item.status !== 'edited') {
      throw Object.assign(new Error('item_not_pending'), {
        code: 'item_not_pending',
        status: item.status,
      });
    }

    // For video approvals, ensure render is ready (not still rendering)
    if (input.decision === 'approve') {
      if (item.renderState === 'queued' || item.renderState === 'rendering' || item.renderState === 'failed') {
        throw Object.assign(new Error('render_not_ready'), { code: 'render_not_ready' });
      }
    }

    if (item.version !== input.expectedVersion) {
      throw Object.assign(new Error('version_conflict'), { code: 'version_conflict' });
    }

    const now = new Date();
    if ((input.decision === 'edit' || input.decision === 'reject') && item.requestId && this.reserveRevision) {
      await this.reserveRevision(item.requestId);
    }

    if (input.decision === 'approve') {
      // Atomic conditional update: WHERE version = expectedVersion
      const updated = await this.reviewItemRepo.update(item.id, {
        status: 'approved',
        resolution: item.renderState !== 'none' ? 'approved_with_edits' : 'approved',
        decidedBy: input.actorUserId,
        decidedVia: input.actorVia,
        decidedAt: now,
        firstOpenedAt: item.firstOpenedAt ?? now,
      }, { expectedVersion: input.expectedVersion, expectedStatus: item.status });
      await this.actionRepo.create({
        reviewItemId: item.id,
        itemVersion: item.version,
        action: 'approved',
        actorUserId: input.actorUserId,
        actorVia: input.actorVia,
        fromStatus: item.status,
        toStatus: 'approved',
        clientElapsedMs: input.clientElapsedMs,
      });
      await this.outboxRepo.enqueue({
        eventType: 'review.decided',
        reviewItemId: item.id,
        payload: { item_id: item.id, decision: 'approve' },
      });
      return updated;
    }

    if (input.decision === 'reject') {
      const updated = await this.reviewItemRepo.update(item.id, {
        status: 'rejected',
        resolution: 'rejected',
        decidedBy: input.actorUserId,
        decidedVia: input.actorVia,
        decidedAt: now,
        decisionNote: input.reasonText,
      }, { expectedVersion: input.expectedVersion, expectedStatus: item.status });
      await this.actionRepo.create({
        reviewItemId: item.id,
        itemVersion: item.version,
        action: 'rejected',
        actorUserId: input.actorUserId,
        actorVia: input.actorVia,
        fromStatus: item.status,
        toStatus: 'rejected',
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        clientElapsedMs: input.clientElapsedMs,
      });
      await this.outboxRepo.enqueue({
        eventType: 'review.decided',
        reviewItemId: item.id,
        payload: { item_id: item.id, decision: 'reject' },
      });
      return updated;
    }

    if (input.decision === 'edit') {
      const updated = await this.reviewItemRepo.update(item.id, {
        status: 'edited',
        renderState: input.rerender ? 'queued' : 'none',
        payload: input.edits
          ? applyEdits(item.payload, input.edits)
          : item.payload,
      }, { expectedVersion: input.expectedVersion, expectedStatus: item.status });
      await this.actionRepo.create({
        reviewItemId: item.id,
        itemVersion: item.version,
        action: 'edited',
        actorUserId: input.actorUserId,
        actorVia: input.actorVia,
        fromStatus: item.status,
        toStatus: 'edited',
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        diff: input.edits,
        clientElapsedMs: input.clientElapsedMs,
      });
      await this.outboxRepo.enqueue({ eventType: 'review.edited', reviewItemId: item.id, payload: { item_id: item.id } });
      return updated;
    }

    if (input.decision === 'manual_reply') {
      const updated = await this.reviewItemRepo.update(item.id, {
        status: 'edited',
        resolution: 'manual_reply',
        finalPayload: { reply_text: input.replyText },
        decidedBy: input.actorUserId,
        decidedVia: input.actorVia,
        decidedAt: now,
      }, { expectedVersion: input.expectedVersion, expectedStatus: item.status });
      await this.actionRepo.create({
        reviewItemId: item.id,
        itemVersion: item.version,
        action: 'manual_reply',
        actorUserId: input.actorUserId,
        actorVia: input.actorVia,
        fromStatus: item.status,
        toStatus: 'edited',
        reasonCode: input.reasonCode,
      });
      await this.outboxRepo.enqueue({
        eventType: 'review.decided',
        reviewItemId: item.id,
        payload: {
          item_id: item.id,
          decision: 'manual_reply',
          reply_text: input.replyText,
        },
      });
      return updated;
    }

    throw new Error(`Unknown decision: ${input.decision}`);
  }

  /** Expire a pending item (called by SLA sweep). */
  async expireItem(itemId: string): Promise<void> {
    const item = await this.reviewItemRepo.findById(itemId);
    if (!item || item.status !== 'pending') return;
    await this.reviewItemRepo.update(itemId, {
      status: 'expired',
      resolution: 'timed_out',
    });
    await this.actionRepo.create({
      reviewItemId: itemId,
      itemVersion: item.version,
      action: 'expired',
      actorVia: 'system',
      fromStatus: 'pending',
      toStatus: 'expired',
    });
    await this.outboxRepo.enqueue({
      eventType: 'review.expired',
      reviewItemId: itemId,
      payload: { item_id: itemId },
    });
  }

  async findById(id: string): Promise<ReviewItem | null> {
    return this.reviewItemRepo.findById(id);
  }

  async listPending(filters?: Parameters<IReviewItemRepository['listPending']>[0]) {
    return this.reviewItemRepo.listPending(filters);
  }
}

/** Validate revision count for a clip request (enforcement of MAX_REVISIONS_PER_CLIP). */
export function assertRevisionAllowed(currentRevisionCount: number): void {
  if (currentRevisionCount >= MAX_REVISIONS_PER_CLIP) {
    throw Object.assign(
      new Error(`max_revisions_exceeded: limit is ${MAX_REVISIONS_PER_CLIP}`),
      { code: 'max_revisions_exceeded', limit: MAX_REVISIONS_PER_CLIP }
    );
  }
}

/** Validate clip duration for LINE intake (enforcement of MAX_CLIP_DURATION_SECONDS). */
export function assertDurationAllowed(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_CLIP_DURATION_SECONDS) {
    throw Object.assign(
      new Error(`duration_exceeded: max is ${MAX_CLIP_DURATION_SECONDS}s`),
      { code: 'duration_exceeded', max: MAX_CLIP_DURATION_SECONDS }
    );
  }
}

function applyEdits(
  payload: Record<string, unknown>,
  edits: DiffEntry[]
): Record<string, unknown> {
  const result = { ...payload };
  for (const edit of edits) {
    result[edit.field] = edit.after;
  }
  return result;
}
