import { AI_CONFIG } from "@/config/aiTools";
import { spacesPublicUrl } from "@/lib/spaces";

interface IGContainerResponse {
  id: string;
}

interface IGPublishResponse {
  id: string;
}

interface IGMediaResponse {
  id: string;
  permalink: string;
}

export async function uploadVideo(params: {
  videoStorageKey: string;
  caption: string;
}): Promise<{ platformVideoId: string; platformUrl: string }> {
  const { accessToken, pageId } = AI_CONFIG.social.instagram;
  const videoUrl = spacesPublicUrl(params.videoStorageKey);

  // Step 1: Create container
  const containerRes = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption: params.caption,
        access_token: accessToken,
        share_to_feed: true,
      }),
    }
  );
  if (!containerRes.ok) throw new Error(`Instagram container creation failed: ${containerRes.status}`);
  const { id: containerId } = await containerRes.json() as IGContainerResponse;

  // Step 2: Wait for container to be ready
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const statusRes = await fetch(
      `https://graph.facebook.com/v18.0/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const statusData = await statusRes.json() as { status_code: string };
    if (statusData.status_code === "FINISHED") break;
    if (statusData.status_code === "ERROR") throw new Error("Instagram media container processing failed");
  }

  // Step 3: Publish container
  const publishRes = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
    }
  );
  if (!publishRes.ok) throw new Error(`Instagram publish failed: ${publishRes.status}`);
  const { id: mediaId } = await publishRes.json() as IGPublishResponse;

  // Step 4: Get permalink
  const mediaRes = await fetch(
    `https://graph.facebook.com/v18.0/${mediaId}?fields=id,permalink&access_token=${accessToken}`
  );
  const media = await mediaRes.json() as IGMediaResponse;

  return {
    platformVideoId: media.id,
    platformUrl: media.permalink ?? `https://www.instagram.com/`,
  };
}
