/** Possible statuses for a review item (5 values). */
export type ReviewItemStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'expired';

/** Whether a re-render is needed/in progress for an edited item. */
export type ReviewRenderState = 'none' | 'queued' | 'rendering' | 'done' | 'failed';

/** How the item entered the pipeline. */
export type ReviewDecisionMode = 'review' | 'auto' | 'sampled';

/** How the decision was made. */
export type ReviewDecidedVia = 'grokbot_app' | 'web' | 'auto' | 'system';

export type ReviewResolution =
  | 'approved'
  | 'auto_approved'
  | 'approved_with_edits'
  | 'rejected'
  | 'manual_reply'
  | 'handoff_taken'
  | 'superseded'
  | 'timed_out'
  | 'cancelled';

export interface MatchedRule {
  key: string;
  kind: 'hard' | 'threshold' | 'sampling';
  version: number;
  reason_th: string;
  reason_en: string;
}

export interface ReviewProducer {
  agent?: string;
  provider?: string;
  model?: string;
  prompt_version?: string;
}

export interface ReviewAssetRef {
  role: 'preview' | 'source' | 'voice';
  asset_id: string;
  storage_key: string;
  mime: string;
}

export interface ReviewItem {
  id: string;
  shortCode: string;
  typeKey: string;
  status: ReviewItemStatus;
  resolution: ReviewResolution | null;
  renderState: ReviewRenderState;
  version: number;
  supersedesId: string | null;

  shopUserId: string;
  requestId: string | null;
  jobId: string | null;
  gateStep: string | null;
  packageOrderId: string | null;
  externalRef: string | null;

  title: string;
  payload: Record<string, unknown>;
  originalPayload: Record<string, unknown> | null;
  assetRefs: ReviewAssetRef[];

  decisionMode: ReviewDecisionMode;
  matchedRules: MatchedRule[];
  ruleSnapshot: Record<string, unknown> | null;
  signals: Record<string, unknown>;
  confidence: number | null;
  producer: ReviewProducer;
  priority: number;

  decidedBy: string | null;
  decidedVia: ReviewDecidedVia | null;
  decisionNote: string | null;
  finalPayload: Record<string, unknown> | null;

  customerNoticedAt: Date | null;
  nextReminderAt: Date | null;
  reminderCount: number;
  dueAt: Date;
  expiresAt: Date;
  etaToldShop: Date | null;

  notifiedAt: Date | null;
  firstOpenedAt: Date | null;
  decidedAt: Date | null;

  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReviewItemInput {
  typeKey: string;
  shopUserId: string;
  requestId?: string;
  jobId?: string;
  gateStep?: string;
  packageOrderId?: string;
  externalRef?: string;
  title: string;
  payload: Record<string, unknown>;
  decisionMode: ReviewDecisionMode;
  matchedRules: MatchedRule[];
  ruleSnapshot?: Record<string, unknown>;
  signals: Record<string, unknown>;
  confidence?: number;
  producer?: ReviewProducer;
  priority?: number;
  dueAt: Date;
  expiresAt: Date;
  idempotencyKey?: string;
  assetRefs?: ReviewAssetRef[];
}
