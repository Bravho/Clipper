/**
 * Translation between Post for Me's wire format and our internal types.
 *
 * This is the ONLY file that knows both vocabularies. Two rules it enforces:
 *
 *  1. Provider platform strings never leak inward.
 *  2. **Tokens never leak inward.** The provider's account payload carries
 *     `access_token` and `refresh_token`; `toConnectedAccount` does not copy
 *     them, and `safeMetadata` strips them from the metadata blob. Nothing
 *     downstream can persist or log a credential it was never handed.
 */

import type {
  ConnectedSocialAccount,
  SocialPlatform,
  SocialPostLifecycle,
  SocialPostTargetResult,
} from "../types";
import { classifyTargetError } from "../errors";

/** Raw account as the API returns it. */
export interface PfmSocialAccount {
  id: string;
  platform: string;
  external_id?: string | null;
  user_id?: string | null;
  username?: string | null;
  profile_photo_url?: string | null;
  status: "connected" | "disconnected";
  metadata?: unknown;
  // access_token / refresh_token are present on the wire and DELIBERATELY not
  // declared here, so nothing can read them by accident.
}

export interface PfmSocialPost {
  id: string;
  status: SocialPostLifecycle;
  external_id?: string | null;
  scheduled_at?: string | null;
}

export interface PfmSocialPostResult {
  id: string;
  post_id: string;
  social_account_id: string;
  success: boolean;
  error?: unknown;
  details?: unknown;
  platform_data?: { id?: string | null; url?: string | null } | null;
}

/**
 * Our platform key → the provider's platform string.
 *
 * Identical today, but the indirection is the point: a provider that spells
 * these differently is then a one-file change.
 */
const PLATFORM_TO_PROVIDER: Record<SocialPlatform, string> = {
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  tiktok_business: "tiktok_business",
  youtube: "youtube",
  x: "x",
  linkedin: "linkedin",
  pinterest: "pinterest",
  threads: "threads",
  bluesky: "bluesky",
};

export function toProviderPlatform(platform: SocialPlatform): string {
  return PLATFORM_TO_PROVIDER[platform];
}

/**
 * Metadata with anything credential-shaped removed.
 *
 * The provider's `metadata` is an open object, so it is filtered by key rather
 * than trusted to contain only safe fields.
 */
function safeMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("password")) {
      continue;
    }
    // Only primitives and shallow structures — nothing that could smuggle a
    // credential in a nested object.
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Provider account → internal account.
 *
 * Note the fields NOT copied: access_token, access_token_expires_at,
 * refresh_token, refresh_token_expires_at. RClipper stores no social
 * credentials, so publishing always goes through the provider.
 */
export function toConnectedAccount(raw: PfmSocialAccount): ConnectedSocialAccount {
  return {
    externalAccountId: raw.id,
    platform: raw.platform,
    externalId: raw.external_id ?? null,
    platformUserId: raw.user_id ?? null,
    username: raw.username ?? null,
    // The API exposes no separate display name; the username is what users
    // recognise, so it doubles as the label until a better field exists.
    displayName: raw.username ?? null,
    avatarUrl: raw.profile_photo_url ?? null,
    status: raw.status,
    metadata: safeMetadata(raw.metadata),
  };
}

/**
 * Provider per-destination result → internal result.
 *
 * `success: false` carries a free-text error, which is classified here so
 * callers get a stable code and users never see a raw provider string.
 */
export function toTargetResult(raw: PfmSocialPostResult): SocialPostTargetResult {
  return {
    externalResultId: raw.id,
    externalPostId: raw.post_id,
    externalAccountId: raw.social_account_id,
    success: raw.success,
    publishedUrl: raw.platform_data?.url ?? null,
    platformPostId: raw.platform_data?.id ?? null,
    error: raw.success ? null : classifyTargetError(raw.error ?? raw.details),
  };
}

/**
 * Provider post status → our per-destination status vocabulary.
 *
 * `processed` deliberately does NOT map to "published": it means the provider
 * finished working through the post, not that every platform accepted it.
 * Success is decided per destination, from the results.
 */
export function lifecycleToTargetStatus(
  lifecycle: SocialPostLifecycle
): "draft" | "scheduled" | "publishing" {
  switch (lifecycle) {
    case "draft":
      return "draft";
    case "scheduled":
      return "scheduled";
    case "processing":
    case "processed":
    default:
      return "publishing";
  }
}
