/**
 * Review system configuration and feature flags.
 *
 * Read at request time (not build time) so the server can flip them with an
 * env change and a restart, identical to studioRollout.ts.
 */

/** Master switch for the review system. */
export function isReviewSystemEnabled(): boolean {
  return process.env.REVIEW_SYSTEM_ENABLED === 'true';
}

/** Master switch for LINE intake channel. */
export function isLineIntakeEnabled(): boolean {
  return process.env.LINE_INTAKE_ENABLED === 'true';
}

/**
 * Render lane routing flag (default OFF).
 * When OFF: INSERT and claim SQL use the pre-migration-049 queries (no render_lane column)
 * so the Mac Mini worker keeps working before migration 049 is applied.
 * When ON: lane-aware queries route LINE jobs to Mac Mini and Mar-PC backup.
 */
export function isRenderLaneEnabled(): boolean {
  return process.env.RENDER_LANE_ENABLED === 'true';
}

/**
 * Rule keys that are HARD-LOCKED in code: even if a shop has a trust policy,
 * these rules can never be bypassed by auto-approve.
 */
export const LOCKED_RULE_KEYS = new Set([
  'wants_human',
  'customer_unhappy',
  'out_of_package',
] as const);

/** Valid reason_code values for review actions. */
export const REASON_CODES = [
  'wrong_price',
  'wrong_menu_name',
  'wrong_shop_info',
  'hallucinated_claim',
  'tone_too_salesy',
  'tone_off_brand',
  'thai_spelling',
  'grammar',
  'caption_too_long',
  'caption_timing',
  'wrong_shot_order',
  'bad_framing',
  'voice_mispronounce',
  'voice_style',
  'music',
  'footage_unusable',
  'policy_risk',
  'customer_context',
  'other',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** Max regex pattern length for DSL conditions (safety limit). */
export const MAX_RULE_REGEX_LENGTH = 300;

/**
 * Shop review order: storyboard -> voice -> video.
 * If the shop reviews a step, Tho's (admin) review of that step is skipped.
 */
export const SHOP_REVIEW_GATE_ORDER = [
  'awaiting_scene_design_approval',
  'awaiting_voice_approval',
  'awaiting_overlay_approval',
] as const;

/** Max revisions per clip enforced server-side. */
export const MAX_REVISIONS_PER_CLIP = 2;

/** Max clip duration in seconds enforced server-side. */
export const MAX_CLIP_DURATION_SECONDS = 90;

/** SLA: how long (seconds) before delivery push is sent on job completion. */
export const DELIVERY_PUSH_DELAY_SECONDS = 0;

/** Short code alphabet (uppercase A-Z 0-9, excluding confusable chars). */
const SHORT_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateShortCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += SHORT_CODE_CHARS[Math.floor(Math.random() * SHORT_CODE_CHARS.length)];
  }
  return code;
}
