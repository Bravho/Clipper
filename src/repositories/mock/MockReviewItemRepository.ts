import { IReviewItemRepository } from '@/repositories/interfaces/IReviewItemRepository';
import {
  ReviewItem,
  ReviewItemStatus,
  CreateReviewItemInput,
} from '@/domain/models/ReviewItem';
import { generateShortCode } from '@/config/reviewSystem';

declare global {
  // eslint-disable-next-line no-var
  var __mockReviewItemStore: Map<string, ReviewItem> | undefined;
}

function getStore(): Map<string, ReviewItem> {
  if (!global.__mockReviewItemStore) global.__mockReviewItemStore = new Map();
  return global.__mockReviewItemStore;
}

export class MockReviewItemRepository implements IReviewItemRepository {
  private store: Map<string, ReviewItem>;

  constructor(store?: Map<string, ReviewItem>) {
    this.store = store ?? getStore();
  }

  async create(input: CreateReviewItemInput): Promise<ReviewItem> {
    const now = new Date();
    const item: ReviewItem = {
      id: crypto.randomUUID(),
      shortCode: generateShortCode(),
      typeKey: input.typeKey,
      status: 'pending',
      resolution: null,
      renderState: 'none',
      version: 1,
      supersedesId: null,
      shopUserId: input.shopUserId,
      requestId: input.requestId ?? null,
      jobId: input.jobId ?? null,
      gateStep: input.gateStep ?? null,
      packageOrderId: input.packageOrderId ?? null,
      externalRef: input.externalRef ?? null,
      title: input.title,
      payload: input.payload,
      originalPayload: input.payload,
      assetRefs: input.assetRefs ?? [],
      decisionMode: input.decisionMode,
      matchedRules: input.matchedRules,
      ruleSnapshot: input.ruleSnapshot ?? null,
      signals: input.signals,
      confidence: input.confidence ?? null,
      producer: input.producer ?? {},
      priority: input.priority ?? 100,
      decidedBy: null,
      decidedVia: null,
      decisionNote: null,
      finalPayload: null,
      customerNoticedAt: null,
      nextReminderAt: null,
      reminderCount: 0,
      dueAt: input.dueAt,
      expiresAt: input.expiresAt,
      etaToldShop: null,
      notifiedAt: null,
      firstOpenedAt: null,
      decidedAt: null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(item.id, item);
    return { ...item };
  }

  async findById(id: string): Promise<ReviewItem | null> {
    const item = this.store.get(id);
    return item ? { ...item } : null;
  }

  async findByShortCode(shortCode: string): Promise<ReviewItem | null> {
    for (const item of this.store.values()) {
      if (item.shortCode === shortCode) return { ...item };
    }
    return null;
  }

  async findByIdempotencyKey(key: string): Promise<ReviewItem | null> {
    for (const item of this.store.values()) {
      if (item.idempotencyKey === key) return { ...item };
    }
    return null;
  }

  async findOpenByJobGate(jobId: string, gateStep: string): Promise<ReviewItem | null> {
    for (const item of this.store.values()) {
      if (
        item.jobId === jobId &&
        item.gateStep === gateStep &&
        (item.status === 'pending' || item.status === 'edited')
      ) {
        return { ...item };
      }
    }
    return null;
  }

  async update(id: string, data: Partial<ReviewItem>, opts?: { expectedVersion?: number; expectedStatus?: string }): Promise<ReviewItem> {
    const item = this.store.get(id);
    if (!item) throw new Error(`ReviewItem ${id} not found`);
    if (opts && (item.version !== opts.expectedVersion || item.status !== opts.expectedStatus)) {
      throw Object.assign(new Error('version_conflict'), { code: 'version_conflict' });
    }
    const updated = { ...item, ...data, version: data.status ? item.version + 1 : item.version, updatedAt: new Date() };
    this.store.set(id, updated);
    return { ...updated };
  }

  async listPending(filters?: {
    shopUserId?: string;
    typeKey?: string;
    status?: ReviewItemStatus[];
    limit?: number;
    afterId?: string;
  }): Promise<ReviewItem[]> {
    const statuses: ReviewItemStatus[] = filters?.status ?? ['pending', 'edited'];
    let results = [...this.store.values()].filter((item) => statuses.includes(item.status));
    if (filters?.shopUserId) results = results.filter((i) => i.shopUserId === filters.shopUserId);
    if (filters?.typeKey) results = results.filter((i) => i.typeKey === filters.typeKey);
    results.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    if (filters?.afterId) {
      const idx = results.findIndex((i) => i.id === filters.afterId);
      results = results.slice(idx + 1);
    }
    return results.slice(0, filters?.limit ?? 50).map((i) => ({ ...i }));
  }

  async listDueForReminder(now: Date): Promise<ReviewItem[]> {
    return [...this.store.values()]
      .filter(
        (i) =>
          i.status === 'pending' &&
          i.nextReminderAt !== null &&
          i.nextReminderAt <= now
      )
      .map((i) => ({ ...i }));
  }

  async listExpired(now: Date): Promise<ReviewItem[]> {
    return [...this.store.values()]
      .filter((i) => i.status === 'pending' && i.expiresAt <= now)
      .map((i) => ({ ...i }));
  }
}
