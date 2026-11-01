import { IReviewOutboxRepository, OutboxEvent } from '@/repositories/interfaces/IReviewOutboxRepository';

export class MockReviewOutboxRepository implements IReviewOutboxRepository {
  private store: Map<string, OutboxEvent>;
  private seq = 0;
  private notificationWindows = new Map<string, { minute: number; count: number }>();

  async reserveHandoffNotification(shopUserId: string): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000);
    const existing = this.notificationWindows.get(shopUserId);
    const window = existing?.minute === minute ? existing : { minute, count: 0 };
    const configured = Number(process.env.LINE_HANDOFF_FORWARD_PER_SHOP_PER_MIN);
    const maximum = Number.isInteger(configured) && configured > 0 ? configured : 6;
    this.notificationWindows.set(shopUserId, window);
    if (window.count >= maximum) return false;
    window.count++;
    return true;
  }

  constructor(store?: Map<string, OutboxEvent>) {
    this.store = store ?? new Map();
  }

  async findByDedupeKey(key: string): Promise<OutboxEvent | null> {
    return [...this.store.values()].find(e => e.dedupeKey === key && e.channel === 'grokbot_app') ?? null;
  }
  async listRecentReplies(accountId?: string, since?: Date): Promise<OutboxEvent[]> {
    return [...this.store.values()].filter(e => e.eventType === 'line.reply' && (!since || e.createdAt > since)
      && (!accountId || e.payload.lineAccountId === accountId)).sort((a,b) => b.createdAt.getTime()-a.createdAt.getTime());
  }
  async countEscalations(shopUserId: string, since: Date): Promise<number> {
    return [...this.store.values()].filter(e => e.state === 'sent' && e.sentAt && e.sentAt > since
      && e.payload.shopUserId === shopUserId && ['review.created','handoff.escalate'].includes(e.eventType)).length;
  }
  async enqueue(input: {
    eventType: string;
    channel?: string;
    reviewItemId?: string;
    dedupeKey?: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: Date;
  }): Promise<OutboxEvent> {
    if (input.dedupeKey) { const existing = await this.findByDedupeKey(input.dedupeKey); if (existing) return existing; }
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
