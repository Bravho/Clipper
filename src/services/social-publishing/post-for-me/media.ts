/**
 * Post for Me — media.
 *
 *   POST /v1/media/create-upload-url → { upload_url, media_url }
 *
 * The API accepts ANY publicly reachable URL in a post's `media[].url`, so the
 * upload endpoint is only needed when our object is not reachable. Ours are
 * private Spaces objects fronted by short-lived signed URLs, which the provider
 * can fetch, so the normal path is a straight pass-through and no bytes are
 * copied.
 *
 * TIMING MATTERS. Provider-hosted media is temporary — deleted when the post
 * publishes, after 24 h if unattached, or when a scheduled post is deleted — and
 * our signed URLs expire in an hour. Both are fine because the URL is minted at
 * SEND time, never at transfer or upload time, and never persisted.
 */

import { postForMeRequest } from "./client";
import { SocialPublishingError } from "../errors";
import type { PrepareMediaInput, PreparedMedia } from "../types";

export async function prepareMedia(input: PrepareMediaInput): Promise<PreparedMedia> {
  if (!input.sourceUrl) {
    throw new SocialPublishingError("unsupported_media", "No media URL was provided.");
  }
  // Pass-through: the provider fetches our signed URL directly, so nothing is
  // duplicated and no extra storage is consumed.
  return { url: input.sourceUrl, thumbnailUrl: input.thumbnailUrl };
}

/**
 * Upload bytes to provider-hosted storage and return the public URL.
 *
 * Reserved for media we cannot expose by URL. Unused on the normal path; kept
 * so the seam exists if a future source is not directly reachable.
 */
export async function uploadMedia(
  body: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<PreparedMedia> {
  const response = await postForMeRequest<{ upload_url: string; media_url: string }>({
    method: "POST",
    path: "/v1/media/create-upload-url",
  });

  if (!response?.upload_url || !response?.media_url) {
    throw new SocialPublishingError(
      "unknown",
      "Post for Me did not return a media upload URL."
    );
  }

  const put = await fetch(response.upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: body as BodyInit,
  });
  if (!put.ok) {
    throw new SocialPublishingError(
      put.status >= 500 ? "provider_unavailable" : "unsupported_media",
      `Media upload failed (${put.status}).`,
      { status: put.status }
    );
  }

  return { url: response.media_url };
}
