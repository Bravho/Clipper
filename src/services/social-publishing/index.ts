/**
 * Social publishing provider — assembly and selection.
 *
 * Import `socialPublishingProvider` from here. Nothing outside
 * `post-for-me/` should import that folder directly; this is the seam that lets
 * a second provider be added without touching the dashboard or business logic.
 */

import type { SocialPublishingProvider } from "./provider";
import * as accounts from "./post-for-me/accounts";
import * as media from "./post-for-me/media";
import * as posts from "./post-for-me/posts";
import { verifyAndParseWebhook } from "./post-for-me/webhooks";

/** Provider key persisted on `social_connections.provider`. */
export const POST_FOR_ME_PROVIDER_KEY = "post_for_me";

const postForMeProvider: SocialPublishingProvider = {
  key: POST_FOR_ME_PROVIDER_KEY,

  createAccountConnection: accounts.createAuthUrl,
  listAccounts: accounts.listAccountsByExternalId,
  getAccount: accounts.getAccount,
  disconnectAccount: accounts.disconnectAccount,

  prepareMedia: media.prepareMedia,

  createPost: posts.createPost,
  getPostStatus: posts.getPostStatus,
  updatePost: posts.updatePost,
  cancelPost: posts.cancelPost,

  verifyAndParseWebhook,
};

/**
 * The configured provider.
 *
 * A single implementation today. When a second arrives, select on config here —
 * every caller already depends on the interface rather than the adapter.
 */
export const socialPublishingProvider: SocialPublishingProvider = postForMeProvider;

export type { SocialPublishingProvider } from "./provider";
export * from "./types";
export { SocialPublishingError } from "./errors";
