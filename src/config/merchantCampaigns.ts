/**
 * Merchant Referral Campaigns — trusted configuration.
 *
 * Read at request time (not build time) so the droplet can change the operator
 * list with an env edit and a restart.
 */

/** The accounts that may open the operator page when the env var is unset. */
const DEFAULT_OPERATOR_EMAILS = ["bravegreatheart@gmail.com", "zephyrothz@hotmail.com"];

/**
 * Who may create shops, templates and campaigns.
 *
 * `CAMPAIGN_OPERATOR_EMAILS` (comma separated) replaces the default list. The
 * check is by e-mail, whatever the account's role, so it works the same for a
 * requester account (dashboard sidebar) and an admin account (admin sidebar).
 */
export function campaignOperatorEmails(): string[] {
  const configured = (process.env.CAMPAIGN_OPERATOR_EMAILS ?? "").trim();
  const list = configured
    ? configured.split(",")
    : DEFAULT_OPERATOR_EMAILS;
  return list.map((email) => email.trim().toLowerCase()).filter(Boolean);
}

export function isCampaignOperator(email: string | null | undefined): boolean {
  if (!email) return false;
  return campaignOperatorEmails().includes(email.trim().toLowerCase());
}

/**
 * Referral code alphabet: no 0/O, 1/I/L, 5/S, 2/Z, 8/B, U/V — the pairs people
 * misread off a phone screen or mistype from a video frame. 23 symbols.
 */
export const REFERRAL_CODE_ALPHABET = "ACDEFGHJKMNPQRTWXY34679";

/**
 * Four characters (A7K4-style) — about 280k codes. A code is only accepted
 * at the merchant it was issued for, so an accidental mistype has to land on
 * one of THAT shop's codes to count. Grows to five when four keeps colliding.
 */
export const REFERRAL_CODE_LENGTH = 4;
export const REFERRAL_CODE_MAX_LENGTH = 6;

export const CAMPAIGN_LIMITS = {
  /** The shortest and longest clip the quick video accepts, seconds. */
  minClipSeconds: 3,
  maxClipSeconds: 15,
  /** The customer's sentence, in user-perceived characters. */
  statementMaxChars: 90,
  /** Default "one reward per device per campaign per N days". */
  defaultRewardCooldownDays: 30,
  maxRewardCooldownDays: 365,
  maxDiscountPercent: 90,
  /** A social post URL. */
  postUrlMaxLength: 500,
  /** Post links one creator may attach to one campaign. */
  maxPostsPerCreatorCampaign: 10,
} as const;

/**
 * Lightweight per-IP limits for the public (no-login) endpoints, per minute.
 * In memory per server process — enough to stop a script hammering the
 * endpoints, not a fraud system (the product principle is low friction).
 */
export const CAMPAIGN_RATE_LIMITS = {
  session: 20,
  write: 40,
  read: 120,
} as const;

/** Pepper for the install-id hash. Falls back to NEXTAUTH_SECRET. */
export function campaignInstallPepper(): string {
  return (
    process.env.CAMPAIGN_INSTALL_PEPPER?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "rclipper-campaign-dev-pepper"
  );
}

/**
 * Creator phone OTP — the same numbers iTravy uses for its redeemer OTP
 * (travel_advisor backend/src/services/referral/otpService.js), so the two
 * halves behave alike.
 */
export const CAMPAIGN_OTP = {
  ttlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  maxSendsPerInstallPerHour: 5,
  maxSendsPerPhonePerHour: 3,
} as const;

/**
 * iTravy API base for the server-to-server referral calls. Authenticated with
 * the same shared `RCLIPPER_API_KEY` iTravy already uses for the video feed.
 */
export function itravyApiBase(): string {
  return (process.env.ITRAVY_API_URL?.trim() || "https://api.travy.buzz").replace(/\/+$/, "");
}
