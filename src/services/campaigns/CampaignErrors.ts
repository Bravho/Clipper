/** A refusal the API turns into `{ error, code }` with the given HTTP status. */
export type CampaignErrorCode =
  | "not_found"
  | "bad_key"
  | "not_live"
  | "ended"
  | "invalid"
  | "bad_install"
  | "no_session"
  | "limit"
  | "forbidden"
  // creator phone OTP (044)
  | "phone_required"
  | "phone_invalid"
  | "otp_unavailable"
  | "otp_cooldown"
  | "rate_limited"
  | "otp_not_found"
  | "otp_expired"
  | "otp_locked"
  | "otp_invalid"
  | "sms_failed"
  // iTravy link (044)
  | "itravy_failed";

export class CampaignError extends Error {
  constructor(
    readonly code: CampaignErrorCode,
    message: string,
    readonly status: number = 400,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CampaignError";
  }
}
