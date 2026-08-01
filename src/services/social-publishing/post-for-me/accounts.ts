/**
 * Post for Me — social account endpoints.
 *
 *   POST   /v1/social-accounts/auth-url        → { platform, url }
 *   GET    /v1/social-accounts?external_id=…   → { data: [...], meta }
 *   GET    /v1/social-accounts/{id}            → account
 *   POST   /v1/social-accounts/{id}/disconnect → account (status disconnected)
 */

import { postForMeRequest } from "./client";
import { toConnectedAccount, toProviderPlatform, type PfmSocialAccount } from "./mappings";
import { POST_FOR_ME_CONFIG } from "@/config/management";
import { SocialPublishingError } from "../errors";
import type {
  AccountConnectionResult,
  ConnectedSocialAccount,
  CreateAccountConnectionInput,
} from "../types";

/**
 * Create an authorization URL for one platform.
 *
 * `external_id` carries OUR user id so the provider tags every account it
 * imports from this grant. That is what later lets us filter by user — though
 * it is a convenience, not an authorisation boundary (see `listAccounts`).
 *
 * `redirect_url_override` only works on White Label projects; on Quickstart the
 * provider uses its own configured redirect and silently ignores an override,
 * so it is sent only when we are actually white-labelled. Sending it regardless
 * would make the Quickstart flow look broken for no reason.
 */
export async function createAuthUrl(
  input: CreateAccountConnectionInput
): Promise<AccountConnectionResult> {
  const isWhiteLabel = POST_FOR_ME_CONFIG.projectType === "white_label";

  const response = await postForMeRequest<{ platform: string; url: string }>({
    method: "POST",
    path: "/v1/social-accounts/auth-url",
    body: {
      platform: toProviderPlatform(input.platform),
      external_id: input.externalId,
      // "posts" is all publishing needs. "feeds" additionally grants read access
      // to everything the account has ever posted, which we do not use and
      // should not ask users to consent to.
      permissions: ["posts"],
      ...(isWhiteLabel && input.redirectUrlOverride
        ? { redirect_url_override: input.redirectUrlOverride }
        : {}),
    },
    // Not retried: the provider may already have created state for the first
    // attempt, and a fresh URL per attempt is the documented expectation anyway.
    maxAttempts: 1,
  });

  if (!response?.url) {
    throw new SocialPublishingError(
      "unknown",
      "Post for Me did not return an authorization URL."
    );
  }

  return { platform: response.platform, authorizationUrl: response.url };
}

/**
 * Accounts tagged with one of our user ids.
 *
 * NOT AN AUTHORISATION BOUNDARY. The API key is project-wide and accounts are
 * globally unique per project — if two RClipper users connect the same Facebook
 * Page, the provider updates a single record and the `external_id` reflects
 * whoever connected most recently. Ownership is decided by our own
 * `social_connections` table; this is only how we discover what exists.
 */
export async function listAccountsByExternalId(
  externalId: string
): Promise<ConnectedSocialAccount[]> {
  const response = await postForMeRequest<{ data?: PfmSocialAccount[] }>({
    method: "GET",
    path: "/v1/social-accounts",
    query: { external_id: [externalId], limit: 100 },
  });
  return (response?.data ?? []).map(toConnectedAccount);
}

/** Re-read one account. Returns null when the provider no longer has it. */
export async function getAccount(
  externalAccountId: string
): Promise<ConnectedSocialAccount | null> {
  try {
    const raw = await postForMeRequest<PfmSocialAccount>({
      method: "GET",
      path: `/v1/social-accounts/${encodeURIComponent(externalAccountId)}`,
    });
    return raw ? toConnectedAccount(raw) : null;
  } catch (err) {
    if (err instanceof SocialPublishingError && err.code === "not_found") return null;
    throw err;
  }
}

/**
 * Disconnect at the provider.
 *
 * Treated as idempotent: an account the provider has already forgotten is the
 * outcome the caller wanted, so a 404 is success rather than an error.
 */
export async function disconnectAccount(externalAccountId: string): Promise<void> {
  try {
    await postForMeRequest<PfmSocialAccount>({
      method: "POST",
      path: `/v1/social-accounts/${encodeURIComponent(externalAccountId)}/disconnect`,
    });
  } catch (err) {
    if (err instanceof SocialPublishingError && err.code === "not_found") return;
    throw err;
  }
}
