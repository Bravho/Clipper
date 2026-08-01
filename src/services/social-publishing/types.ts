/**
 * Internal, provider-neutral types for social publishing.
 *
 * NOTHING HERE MENTIONS POST FOR ME. The rest of RClipper depends on these
 * shapes, and a second provider can be added later by writing another adapter
 * rather than touching the dashboard or the business logic.
 *
 * These are deliberately separate from `src/domain/enums/Platform.ts`, which
 * describes the VIDEO GENERATOR's output channels (and includes Travy and a CDN
 * download that are not social destinations at all). Publishing platforms are a
 * different, larger set, and the two must not be conflated.
 */

/**
 * Social platforms a user can connect and publish to.
 *
 * This list mirrors what the current provider supports. Adding one here is not
 * enough on its own — `post-for-me/mappings.ts` must know its provider string.
 */
export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "tiktok_business"
  | "youtube"
  | "x"
  | "linkedin"
  | "pinterest"
  | "threads"
  | "bluesky";

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "tiktok_business",
  "youtube",
  "x",
  "linkedin",
  "pinterest",
  "threads",
  "bluesky",
] as const;

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return (
    typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value)
  );
}

/** Human-readable labels for the connection UI. */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  tiktok_business: "TikTok Business",
  youtube: "YouTube",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  threads: "Threads",
  bluesky: "Bluesky",
};

/**
 * A connected account as the rest of the app sees it.
 *
 * NOTE WHAT IS ABSENT: no access token, no refresh token, no expiry. The
 * provider returns those; the adapter drops them at the boundary. They must
 * never reach this type, the database, or a log line.
 */
export interface ConnectedSocialAccount {
  /** The provider's account id (e.g. "sa_1234"). */
  externalAccountId: string;
  platform: string;
  /** Our own user id, echoed back by the provider for ownership checks. */
  externalId: string | null;
  /** The platform's own account id. */
  platformUserId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: "connected" | "disconnected";
  /** Non-sensitive provider metadata only. */
  metadata: Record<string, unknown> | null;
}

export interface CreateAccountConnectionInput {
  platform: SocialPlatform;
  /** Our user id, passed as the provider's `external_id`. */
  externalId: string;
  /**
   * Where the provider sends the user afterwards. Only honoured on White Label
   * projects — Quickstart uses the provider's own configured redirect.
   */
  redirectUrlOverride?: string;
}

export interface AccountConnectionResult {
  platform: string;
  /** Send the user here to authorise. Generate a fresh one per attempt. */
  authorizationUrl: string;
}

/** Media prepared for a post. */
export interface PreparedMedia {
  /** A publicly reachable URL the provider can fetch. */
  url: string;
  thumbnailUrl?: string;
}

export interface PrepareMediaInput {
  /** A signed, publicly reachable URL to our own object. */
  sourceUrl: string;
  thumbnailUrl?: string;
}

/** One destination of a post. */
export interface SocialPostTargetInput {
  externalAccountId: string;
  platform: string;
  caption?: string;
  title?: string;
}

export interface CreateSocialPostInput {
  /** Default caption; a target may override it. */
  caption: string;
  media: PreparedMedia[];
  targets: SocialPostTargetInput[];
  /** UTC instant. Absent means publish immediately. */
  scheduledAt?: Date | null;
  /** Our publication id, so provider events can be correlated back. */
  externalId?: string;
  isDraft?: boolean;
}

export interface CreateSocialPostResult {
  externalPostId: string;
  status: SocialPostLifecycle;
}

/**
 * Edit an existing post at the provider.
 *
 * ONLY valid while the post is still `draft` or `scheduled`. The provider (and
 * the platforms) refuse edits once a post is `processing` or `processed`, so the
 * caller must gate on status before calling this — a live post cannot be
 * rewritten through the API.
 *
 * Every field is optional: only what is supplied is changed. Per-destination
 * copy is expressed through `targets`, mirroring `CreateSocialPostInput`.
 */
export interface UpdateSocialPostInput {
  externalPostId: string;
  /** New post-level default caption. */
  caption?: string;
  /** Per-destination copy overrides. */
  targets?: SocialPostTargetInput[];
  /** New UTC instant; null clears the schedule (publish immediately). */
  scheduledAt?: Date | null;
}

/**
 * Provider-neutral post lifecycle.
 *
 * `Processed` means the provider finished working through the post — NOT that
 * every destination succeeded. Per-destination success lives in the results.
 */
export type SocialPostLifecycle = "draft" | "scheduled" | "processing" | "processed";

export interface SocialPostStatus {
  externalPostId: string;
  status: SocialPostLifecycle;
  results: SocialPostTargetResult[];
}

/** The outcome for ONE destination. */
export interface SocialPostTargetResult {
  externalResultId: string;
  externalPostId: string;
  externalAccountId: string;
  success: boolean;
  /** Live URL of the published post, when the platform returned one. */
  publishedUrl: string | null;
  /** Platform's own post id. */
  platformPostId: string | null;
  /** Classified, safe error — never a raw provider payload. */
  error: { code: string; message: string } | null;
}

/** A verified inbound provider event. */
export interface SocialWebhookEvent {
  /** Stable id for deduplication. */
  id: string;
  type: SocialWebhookEventType;
  /** Raw parsed body, for storage. Never rendered to a user. */
  payload: Record<string, unknown>;
}

export type SocialWebhookEventType =
  | "social.post.created"
  | "social.post.updated"
  | "social.post.deleted"
  | "social.post.result.created"
  | "social.account.created"
  | "social.account.updated"
  | "unknown";
