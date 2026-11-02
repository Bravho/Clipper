export type OutboxState = 'queued' | 'sending' | 'sent' | 'failed' | 'dead';

export interface OutboxEvent {
  id: string;
  eventId: string;
  eventType: string;
  channel: string;
  reviewItemId: string | null;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  lastStatusCode: number | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface IReviewOutboxRepository {
  reserveHandoffNotification?(shopUserId: string): Promise<boolean>;
  findByDedupeKey(key: string): Promise<OutboxEvent | null>;
  listRecentReplies(accountId?: string, since?: Date): Promise<OutboxEvent[]>;
  countEscalations(shopUserId: string, since: Date): Promise<number>;
  /**
   * Atomically take one per-shop escalation slot for the claimed (sending) row
   * `eventRowId`: TRUE when fewer than `limit` other escalations for the shop
   * were sent or reserved since `since`, and stamps the row as reserved
   * (sent_at). Serialised per shop with a transaction advisory lock, so several
   * workers can never overshoot the cap.
   */
  reserveEscalationSlot(eventRowId: string, shopUserId: string, since: Date, limit: number): Promise<boolean>;
  enqueue(input: {
    eventType: string;
    channel?: string;
    reviewItemId?: string;
    dedupeKey?: string;
    payload: Record<string, unknown>;
    nextAttemptAt?: Date;
  }): Promise<OutboxEvent>;
  /** Atomically claim the next queued/failed event ready to send. */
  claimNext(): Promise<OutboxEvent | null>;
  markSent(id: string): Promise<void>;
  /** Release the lease without treating human takeover as a failed attempt. */
  defer(id: string, nextAttemptAt: Date): Promise<void>;
  markFailed(id: string, error: string, statusCode?: number, nextAttemptAt?: Date): Promise<void>;
  markDead(id: string): Promise<void>;
}
