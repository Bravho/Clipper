import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient as s3Client } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";

interface FBUploadInitResponse {
  video_id: string;
  upload_url: string;
}

interface FBPublishResponse {
  id: string;
  post_id?: string;
}

export async function uploadVideo(params: {
  videoStorageKey: string;
  description: string;
}): Promise<{ platformVideoId: string; platformUrl: string }> {
  const { pageToken, pageId } = AI_CONFIG.social.facebook;

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

  // Step 1: Initiate upload session
  const initRes = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/videos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_phase: "start",
        file_size: videoBuffer.byteLength,
        access_token: pageToken,
      }),
    }
  );
  if (!initRes.ok) throw new Error(`Facebook upload init failed: ${initRes.status}`);
  const { video_id, upload_url } = await initRes.json() as FBUploadInitResponse;

  // Step 2: Upload video bytes
  const uploadRes = await fetch(upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${pageToken}`,
      "Content-Type": "video/mp4",
      offset: "0",
      file_size: String(videoBuffer.byteLength),
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error(`Facebook video upload failed: ${uploadRes.status}`);

  // Step 3: Finish upload and publish
  const finishRes = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/videos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_phase: "finish",
        video_file_chunk: video_id,
        description: params.description,
        access_token: pageToken,
      }),
    }
  );
  if (!finishRes.ok) throw new Error(`Facebook publish finish failed: ${finishRes.status}`);
  const result = await finishRes.json() as FBPublishResponse;

  return {
    platformVideoId: video_id,
    platformUrl: `https://www.facebook.com/${pageId}/videos/${video_id}`,
  };
}
