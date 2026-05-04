import { AI_CONFIG } from "@/config/aiTools";

interface TventPublishResponse {
  id: string;
  url: string;
}

/**
 * Publish a video to the Tvent platform using the YouTube video URL.
 * Tvent embeds YouTube videos rather than hosting its own copy.
 */
export async function uploadVideo(params: {
  youtubeUrl: string;
  title: string;
  description: string;
}): Promise<{ platformVideoId: string; platformUrl: string }> {
  const { apiKey, apiUrl } = AI_CONFIG.social.tvent;

  const res = await fetch(`${apiUrl}/api/videos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      youtube_url: params.youtubeUrl,
      title: params.title,
      description: params.description,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tvent API error ${res.status}: ${text}`);
  }

  const data = await res.json() as TventPublishResponse;
  return {
    platformVideoId: data.id,
    platformUrl: data.url,
  };
}
