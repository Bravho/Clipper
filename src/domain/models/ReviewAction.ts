export type ReviewActionType =
  | 'created' | 'auto_approved' | 'sampled' | 'notified' | 'opened'
  | 'approved' | 'rejected' | 'edited' | 'manual_reply' | 'handoff_taken'
  | 'rerender_requested' | 'rerender_done' | 'rerender_failed'
  | 'reminder_sent' | 'customer_noticed' | 'overdue' | 'expired'
  | 'superseded' | 'comment' | 'applied' | 'apply_failed';

export type ReviewActorVia = 'grokbot_app' | 'web' | 'auto' | 'system' | 'grokbot';

export type ReviewReasonCode =
  | 'wrong_price' | 'wrong_menu_name' | 'wrong_shop_info' | 'hallucinated_claim'
  | 'tone_too_salesy' | 'tone_off_brand' | 'thai_spelling' | 'grammar'
  | 'caption_too_long' | 'caption_timing' | 'wrong_shot_order' | 'bad_framing'
  | 'voice_mispronounce' | 'voice_style' | 'music' | 'footage_unusable'
  | 'policy_risk' | 'customer_context' | 'other';

export interface DiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ReviewAction {
  id: string;
  reviewItemId: string;
  itemVersion: number;
  action: ReviewActionType;
  actorUserId: string | null;
  actorVia: ReviewActorVia;
  fromStatus: string | null;
  toStatus: string | null;
  reasonCode: ReviewReasonCode | null;
  reasonText: string | null;
  diff: DiffEntry[] | null;
  detail: Record<string, unknown>;
  clientElapsedMs: number | null;
  createdAt: Date;
}

export interface CreateReviewActionInput {
  reviewItemId: string;
  itemVersion: number;
  action: ReviewActionType;
  actorUserId?: string;
  actorVia: ReviewActorVia;
  fromStatus?: string;
  toStatus?: string;
  reasonCode?: ReviewReasonCode;
  reasonText?: string;
  diff?: DiffEntry[];
  detail?: Record<string, unknown>;
  clientElapsedMs?: number;
}
