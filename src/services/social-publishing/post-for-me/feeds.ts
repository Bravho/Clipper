/**
 * Post for Me — social account feeds (post metrics).
 *
 *   GET /v1/social-account-feeds/{social_account_id}?expand=metrics
 *       &social_post_id=sp_…   (repeatable, OR)
 *       &platform_post_id=…    (repeatable, OR)
 *   → { data: PlatformPost[], meta: { cursor, limit, next, has_more } }
 *
 * The account must have been connected with the "feeds" permission; otherwise
 * the provider refuses and we surface `feeds_not_granted` so the UI can ask the
 * owner to reconnect. Metrics are the post's current lifetime values.
 *
 * Field names follow the provider's published SDK types (post-for-me v2.9).
 */

import { postForMeRequest } from "./client";
import { SocialPublishingError } from "../errors";
import type { GetPostInsightsInput, SocialPostInsight } from "../types";

interface PfmPlatformPost {
  platform?: string;
  platform_post_id?: string | null;
  platform_url?: string | null;
  social_account_id?: string;
  social_post_id?: string | null;
  posted_at?: string | null;
  metrics?: Record<string, unknown> | null;
}

interface PfmFeedResponse {
  data?: PfmPlatformPost[];
  meta?: { cursor?: string | null; next?: string | null; has_more?: boolean };
}

/** Upper bound on pages read per call, so one request cannot run away. */
const MAX_PAGES = 3;

export async function getPostInsights(
  input: GetPostInsightsInput
): Promise<SocialPostInsight[]> {
  const out: SocialPostInsight[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let response: PfmFeedResponse;
    try {
      response = await postForMeRequest<PfmFeedResponse>({
        method: "GET",
        path: `/v1/social-account-feeds/${encodeURIComponent(input.externalAccountId)}`,
        query: {
          expand: "metrics",
          ...(input.externalPostIds?.length ? { social_post_id: input.externalPostIds } : {}),
          ...(input.platformPostIds?.length ? { platform_post_id: input.platformPostIds } : {}),
          ...(cursor ? { cursor } : {}),
        },
      });
    } catch (err) {
      if (
        err instanceof SocialPublishingError &&
        (err.code === "permission_denied" || /feed|permission|scope/i.test(err.message))
      ) {
        throw new SocialPublishingError(
          "permission_denied",
          "feeds_not_granted: reconnect this account with analytics access to read its results."
        );
      }
      throw err;
    }

    for (const item of response?.data ?? []) {
      out.push({
        externalAccountId: item.social_account_id ?? input.externalAccountId,
        platform: item.platform ?? "",
        platformPostId: item.platform_post_id ?? null,
        platformUrl: item.platform_url ?? null,
        externalPostId: item.social_post_id ?? null,
        postedAt: item.posted_at ?? null,
        metrics: item.metrics ?? null,
      });
    }

    const next = response?.meta?.has_more ? response.meta.cursor ?? undefined : undefined;
    if (!next || next === cursor) break;
    cursor = next;
  }

  return out;
}
