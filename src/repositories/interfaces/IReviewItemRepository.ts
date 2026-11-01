import {
  ReviewItem,
  ReviewItemStatus,
  CreateReviewItemInput,
} from '@/domain/models/ReviewItem';

export interface IReviewItemRepository {
  create(input: CreateReviewItemInput): Promise<ReviewItem>;
  findById(id: string): Promise<ReviewItem | null>;
  findByShortCode(shortCode: string): Promise<ReviewItem | null>;
  findByIdempotencyKey(key: string): Promise<ReviewItem | null>;
  /** Find open item (pending|edited) for a given job+gate (prevents duplicate cards). */
  findOpenByJobGate(jobId: string, gateStep: string): Promise<ReviewItem | null>;
  update(
    id: string,
    data: Partial<
      Pick<
        ReviewItem,
        | 'status'
        | 'resolution'
        | 'renderState'
        | 'version'
        | 'decidedBy'
        | 'decidedVia'
        | 'decisionNote'
        | 'finalPayload'
        | 'payload'
        | 'notifiedAt'
        | 'firstOpenedAt'
        | 'decidedAt'
        | 'nextReminderAt'
        | 'reminderCount'
        | 'reminderSentAt'
        | 'customerNoticedAt'
        | 'supersedesId'
        | 'priority'
      >
    >,
    opts?: { expectedVersion?: number; expectedStatus?: ReviewItemStatus }
  ): Promise<ReviewItem>;
  listPending(filters?: {
    shopUserId?: string;
    typeKey?: string;
    status?: ReviewItemStatus[];
    limit?: number;
    afterId?: string;
  }): Promise<ReviewItem[]>;
  /** Items whose SLA timer has passed (for the sweep job). */
  claimReminder(id: string, now: Date): Promise<boolean>;
  listDueForReminder(now: Date): Promise<ReviewItem[]>;
  listExpired(now: Date): Promise<ReviewItem[]>;
}
