/**
 * The seam between RClipper and whatever service actually posts to social
 * platforms.
 *
 * Everything outside `post-for-me/` depends on THIS interface and never imports
 * the Post for Me client directly. That is what makes a second provider an
 * additive change rather than a rewrite of the dashboard and business logic.
 *
 * Shaped around what the current provider genuinely offers — no speculative
 * methods, and no method that would need a capability the API does not have.
 */

import type {
  AccountConnectionResult,
  ConnectedSocialAccount,
  CreateAccountConnectionInput,
  CreateSocialPostInput,
  CreateSocialPostResult,
  PrepareMediaInput,
  PreparedMedia,
  SocialPostStatus,
  SocialWebhookEvent,
  UpdateSocialPostInput,
} from "./types";

export interface SocialPublishingProvider {
  /** Stable key stored on `social_connections.provider`. */
  readonly key: string;

  /**
   * Begin an account connection. Returns a URL to send the user to.
   *
   * Generate a fresh URL for every attempt — these should not be cached or
   * reused across sessions.
   */
  createAccountConnection(
    input: CreateAccountConnectionInput
  ): Promise<AccountConnectionResult>;

  /**
   * Accounts belonging to one of our users, filtered by `external_id`.
   *
   * Filtering happens at the provider, but the caller must STILL check
   * ownership against our own `social_connections` table: the API key is
   * project-wide, and accounts are globally unique per project, so provider
   * filtering alone is not an authorisation boundary.
   */
  listAccounts(externalId: string): Promise<ConnectedSocialAccount[]>;

  /** Re-read one account, to refresh cached display metadata and status. */
  getAccount(externalAccountId: string): Promise<ConnectedSocialAccount | null>;

  /** Disconnect an account at the provider. Idempotent. */
  disconnectAccount(externalAccountId: string): Promise<void>;

  /**
   * Make media reachable by the provider.
   *
   * Our objects live in private storage, so this normally just passes through a
   * freshly-minted signed URL. It exists as a seam because a provider may
   * instead require an upload handshake.
   */
  prepareMedia(input: PrepareMediaInput): Promise<PreparedMedia>;

  /** Create (and schedule, or immediately publish) a post. */
  createPost(input: CreateSocialPostInput): Promise<CreateSocialPostResult>;

  /** Current status plus every per-destination result. */
  getPostStatus(externalPostId: string): Promise<SocialPostStatus>;

  /**
   * Edit a post that has NOT yet been published.
   *
   * Only meaningful while the post is still `draft` or `scheduled`; the provider
   * rejects edits to a post that is `processing` or `processed`, because a live
   * post cannot be changed through the API. Callers gate on status first.
   */
  updatePost(input: UpdateSocialPostInput): Promise<void>;

  /**
   * Cancel a post. Only meaningful while it is still scheduled — once the
   * provider has begun publishing, the platform post exists and cancelling here
   * would not unpublish it.
   */
  cancelPost(externalPostId: string): Promise<void>;

  /**
   * Verify an inbound webhook and parse it.
   *
   * Returns null when the request is not authentic, so the route can reject it
   * without needing to know how verification works.
   */
  verifyAndParseWebhook(
    headers: Headers,
    rawBody: string
  ): SocialWebhookEvent | null;
}
