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
  markFailed(id: string, error: string, statusCode?: number, nextAttemptAt?: Date): Promise<void>;
  markDead(id: string): Promise<void>;
}
