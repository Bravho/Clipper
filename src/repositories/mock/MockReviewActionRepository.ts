import { IReviewActionRepository } from '@/repositories/interfaces/IReviewActionRepository';
import { ReviewAction, CreateReviewActionInput } from '@/domain/models/ReviewAction';

export class MockReviewActionRepository implements IReviewActionRepository {
  private store: Map<string, ReviewAction>;
  private seq = 0;

  constructor(store?: Map<string, ReviewAction>) {
    this.store = store ?? new Map();
  }

  async create(input: CreateReviewActionInput): Promise<ReviewAction> {
    const action: ReviewAction = {
      id: String(++this.seq),
      reviewItemId: input.reviewItemId,
      itemVersion: input.itemVersion,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorVia: input.actorVia,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reasonCode: input.reasonCode ?? null,
      reasonText: input.reasonText ?? null,
      diff: input.diff ?? null,
      detail: input.detail ?? {},
      clientElapsedMs: input.clientElapsedMs ?? null,
      createdAt: new Date(),
    };
    this.store.set(action.id, action);
    return { ...action };
  }

  async listByItem(reviewItemId: string): Promise<ReviewAction[]> {
    return [...this.store.values()]
      .filter((a) => a.reviewItemId === reviewItemId)
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((a) => ({ ...a }));
  }
}
