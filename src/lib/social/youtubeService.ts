import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient as s3Client } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";

interface YouTubeTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface YouTubeUploadResponse {
  id: string;
  kind: string;
  snippet?: { title: string };
}

async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret, refreshToken } = AI_CONFIG.social.youtube;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`YouTube token refresh failed: ${res.status}`);
  const data = await res.json() as YouTubeTokenResponse;
  return data.access_token;
}

export async function uploadVideo(params: {
  videoStorageKey: string;
  title: string;
  description: string;
}): Promise<{ platformVideoId: string; platformUrl: string }> {
  const accessToken = await getAccessToken();

  // Download video from DO Spaces
  const bucket = process.env.DO_SPACES_BUCKET!;
  const getRes = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: params.videoStorageKey })
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of getRes.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const videoBuffer = Buffer.concat(chunks);

  // Initiate resumable upload
  const metadata = {
    snippet: { title: params.title, description: params.description, categoryId: "22" },
    status: { privacyStatus: "public" },
  };

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(videoBuffer.byteLength),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) throw new Error(`YouTube upload init failed: ${initRes.status}`);
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL");

  // Upload video bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoBuffer.byteLength),
    },
    body: videoBuffer,
  });

  if (!uploadRes.ok) throw new Error(`YouTube video upload failed: ${uploadRes.status}`);
  const result = await uploadRes.json() as YouTubeUploadResponse;
  const videoId = result.id;

  return {
    platformVideoId: videoId,
    platformUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
