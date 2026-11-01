import { IReviewOutboxRepository, OutboxEvent } from '@/repositories/interfaces/IReviewOutboxRepository';

export class MockReviewOutboxRepository implements IReviewOutboxRepository {
  private store: Map<string, OutboxEvent>;
  private seq = 0;

  constructor(store?: Map<string, OutboxEvent>) {
    this.store = store ?? new Map();
  }

  async enqueue(input: {
    eventType: string;
    channel?: string;
    reviewItemId?: string;
    dedupeKey?: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: Date;
  }): Promise<OutboxEvent> {
    const now = new Date();
    const event: OutboxEvent = {
      id: String(++this.seq),
      eventId: crypto.randomUUID(),
      eventType: input.eventType,
      channel: input.channel ?? 'grokbot_app',
      reviewItemId: input.reviewItemId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      payload: input.payload,
      state: 'queued',
      attempts: 0,
      nextAttemptAt: input.nextAttemptAt ?? now,
      lastError: null,
      lastStatusCode: null,
      sentAt: null,
      createdAt: now,
    };
    this.store.set(event.id, event);
    return { ...event };
  }

  async claimNext(): Promise<OutboxEvent | null> {
    const now = new Date();
    for (const [id, ev] of this.store.entries()) {
      if (
        (ev.state === 'queued' || ev.state === 'failed') &&
        ev.nextAttemptAt <= now
      ) {
        const claimed = { ...ev, state: 'sending' as const, attempts: ev.attempts + 1 };
        this.store.set(id, claimed);
        return { ...claimed };
      }
    }
    return null;
  }

  async markSent(id: string): Promise<void> {
    const ev = this.store.get(id);
    if (!ev) return;
    this.store.set(id, { ...ev, state: 'sent', sentAt: new Date() });
  }

  async defer(id: string, nextAttemptAt: Date): Promise<void> {
    const ev = this.store.get(id);
    if (ev) this.store.set(id, { ...ev, state: 'queued', attempts: Math.max(0, ev.attempts - 1), nextAttemptAt });
  }

  async markFailed(
    id: string,
    error: string,
    statusCode?: number,
    nextAttemptAt?: Date
  ): Promise<void> {
    const ev = this.store.get(id);
    if (!ev) return;
    this.store.set(id, {
      ...ev,
      state: 'failed',
      lastError: error,
      lastStatusCode: statusCode ?? null,
      nextAttemptAt: nextAttemptAt ?? new Date(Date.now() + 30_000),
    });
  }

  async markDead(id: string): Promise<void> {
    const ev = this.store.get(id);
    if (!ev) return;
    this.store.set(id, { ...ev, state: 'dead' });
  }
}
