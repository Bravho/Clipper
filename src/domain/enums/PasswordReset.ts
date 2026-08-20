/**
 * Password-reset outcome vocabulary.
 *
 * Lives in `domain/` rather than beside PasswordResetService because the
 * client components render these values. Importing them from the service
 * would drag bcrypt, node:crypto and nodemailer into the browser bundle;
 * this module has no imports at all.
 */

export enum ResetRequestOutcome {
  /** Address is registered, link generated, mail accepted by the provider. */
  Sent = "sent",
  /** No account with this address (or the account was deleted). */
  UnknownEmail = "unknown_email",
  /** Account exists but signs in with Google/Apple — it has no password. */
  SocialOnly = "social_only",
  /** Address checked out; the mail provider refused or timed out. */
  EmailFailed = "email_failed",
  /** A link was already sent moments ago; not sending another yet. */
  Throttled = "throttled",
}

export enum ResetTokenState {
  Valid = "valid",
  /** No such token — wrong link, or superseded by a newer request. */
  Invalid = "invalid",
  Expired = "expired",
  /** Already spent. A password was set with this link once. */
  Used = "used",
}
