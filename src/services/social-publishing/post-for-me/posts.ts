/**
 * Post for Me — social posts and their results.
 *
 *   POST   /v1/social-posts                        → post
 *   GET    /v1/social-posts/{id}                   → post
 *   DELETE /v1/social-posts/{id}                   → deletion result
 *   GET    /v1/social-post-results?post_id=…       → { data: [...], meta }
 *
 * Per-platform copy is expressed through `account_configurations`: one entry per
 * destination whose `configuration.caption` / `.title` override the post-level
 * defaults. That is how one video goes out with a different caption on TikTok
 * than on YouTube in a single call.
 */

import { postForMeRequest } from "./client";
import { toTargetResult, type PfmSocialPost, type PfmSocialPostResult } from "./mappings";
import { SocialPublishingError } from "../errors";
import type {
  CreateSocialPostInput,
  CreateSocialPostResult,
  SocialPostStatus,
  SocialPostTargetResult,
  UpdateSocialPostInput,
} from "../types";

/**
 * Create a post.
 *
 * `scheduled_at` absent or null means publish immediately. We send the UTC ISO
 * instant, never a local time.
 *
 * `external_id` carries OUR publication id so inbound webhooks and results can
 * be correlated back without a lookup table.
 *
 * NOT RETRIED. A create that times out may well have succeeded, and retrying
 * would risk publishing the same video twice — the one failure mode users would
 * never forgive. Recovery is by reconciliation (look for a post carrying our
 * `external_id`), not by blind retry.
 */
export async function createPost(
  input: CreateSocialPostInput
): Promise<CreateSocialPostResult> {
  if (input.targets.length === 0) {
    throw new SocialPublishingError(
      "validation_failed",
      "A post needs at least one destination."
    );
  }

  const accountConfigurations = input.targets
    .filter((t) => t.caption !== undefined || t.title !== undefined)
    .map((t) => ({
      social_account_id: t.externalAccountId,
      configuration: {
        ...(t.caption !== undefined ? { caption: t.caption } : {}),
        ...(t.title !== undefined ? { title: t.title } : {}),
      },
    }));

  const response = await postForMeRequest<PfmSocialPost>({
    method: "POST",
    path: "/v1/social-posts",
    body: {
      caption: input.caption,
      social_accounts: input.targets.map((t) => t.externalAccountId),
      media: input.media.map((m) => ({
        url: m.url,
        ...(m.thumbnailUrl ? { thumbnail_url: m.thumbnailUrl } : {}),
      })),
      ...(input.scheduledAt ? { scheduled_at: input.scheduledAt.toISOString() } : {}),
      ...(input.externalId ? { external_id: input.externalId } : {}),
      ...(input.isDraft ? { isDraft: true } : {}),
      ...(accountConfigurations.length > 0
        ? { account_configurations: accountConfigurations }
        : {}),
    },
    maxAttempts: 1,
  });

  if (!response?.id) {
    throw new SocialPublishingError("unknown", "Post for Me did not return a post id.");
  }

  return { externalPostId: response.id, status: response.status };
}

/**
 * Edit a post at the provider (PUT /v1/social-posts/{id}).
 *
 * The API permits this ONLY while the post is `draft` or `scheduled`; a request
 * against a `processing`/`processed` post is rejected. The service layer checks
 * status before calling, so reaching a provider rejection here means the post
 * went live between the check and the call — surfaced as a normal error.
 *
 * Only supplied fields are sent, so an edit that changes just one destination's
 * caption does not disturb the others. Per-destination copy uses the same
 * `account_configurations` shape as create.
 *
 * NOT RETRIED: like create, an edit that times out may have applied, and a blind
 * retry could clobber a concurrent change. maxAttempts is 1.
 */
export async function updatePost(input: UpdateSocialPostInput): Promise<void> {
  const accountConfigurations = (input.targets ?? [])
    .filter((t) => t.caption !== undefined || t.title !== undefined)
    .map((t) => ({
      social_account_id: t.externalAccountId,
      configuration: {
        ...(t.caption !== undefined ? { caption: t.caption } : {}),
        ...(t.title !== undefined ? { title: t.title } : {}),
      },
    }));

  const body: Record<string, unknown> = {
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.scheduledAt !== undefined
      ? { scheduled_at: input.scheduledAt ? input.scheduledAt.toISOString() : null }
      : {}),
    ...(accountConfigurations.length > 0
      ? { account_configurations: accountConfigurations }
      : {}),
  };

  await postForMeRequest<PfmSocialPost>({
    method: "PUT",
    path: `/v1/social-posts/${encodeURIComponent(input.externalPostId)}`,
    body,
    maxAttempts: 1,
  });
}

/**
 * Current status plus every per-destination result.
 *
 * Both are fetched because the post's own status says only how far the provider
 * has got, never whether an individual platform accepted the video.
 */
export async function getPostStatus(externalPostId: string): Promise<SocialPostStatus> {
  const post = await postForMeRequest<PfmSocialPost>({
    method: "GET",
    path: `/v1/social-posts/${encodeURIComponent(externalPostId)}`,
  });

  if (!post?.id) {
    throw new SocialPublishingError("not_found", "Post not found at the provider.");
  }

  return {
    externalPostId: post.id,
    status: post.status,
    results: await listPostResults(externalPostId),
  };
}

/** Every per-destination result for one post. */
export async function listPostResults(
  externalPostId: string
): Promise<SocialPostTargetResult[]> {
  const response = await postForMeRequest<{ data?: PfmSocialPostResult[] }>({
    method: "GET",
    path: "/v1/social-post-results",
    query: { post_id: externalPostId, limit: 100 },
  });
  return (response?.data ?? []).map(toTargetResult);
}

/** Fetch one result by id, for a `social.post.result.created` webhook. */
export async function getPostResult(
  externalResultId: string
): Promise<SocialPostTargetResult | null> {
  try {
    const raw = await postForMeRequest<PfmSocialPostResult>({
      method: "GET",
      path: `/v1/social-post-results/${encodeURIComponent(externalResultId)}`,
    });
    return raw ? toTargetResult(raw) : null;
  } catch (err) {
    if (err instanceof SocialPublishingError && err.code === "not_found") return null;
    throw err;
  }
}

/**
 * Delete a post at the provider.
 *
 * Only meaningful while it is still scheduled. Once publishing has begun the
 * platform post exists, and deleting here does NOT unpublish it — so callers
 * must not present this as "undo" for something already live.
 */
export async function cancelPost(externalPostId: string): Promise<void> {
  try {
    await postForMeRequest<unknown>({
      method: "DELETE",
      path: `/v1/social-posts/${encodeURIComponent(externalPostId)}`,
    });
  } catch (err) {
    // Already gone is the outcome the caller wanted.
    if (err instanceof SocialPublishingError && err.code === "not_found") return;
    throw err;
  }
}
