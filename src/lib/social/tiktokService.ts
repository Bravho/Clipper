import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient as s3Client } from "@/lib/spaces";
import { GetObjectCommand } from "@aws-sdk/client-s3";

interface TikTokInitUploadResponse {
  data: {
    publish_id: string;
    upload_url: string;
  };
  error: { code: string; message: string };
}

interface TikTokStatusResponse {
  data: {
    publish_id: string;
    status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "PUBLISH_COMPLETE" | "FAILED";
    share_url?: string;
  };
  error: { code: string; message: string };
}

export async function uploadVideo(params: {
  videoStorageKey: string;
  title: string;
  description: string;
}): Promise<{ platformVideoId: string; platformUrl: string }> {
  const { accessToken } = AI_CONFIG.social.tiktok;

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

  // Step 1: Initiate upload
  const initRes = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: params.description.slice(0, 150),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoBuffer.byteLength,
          chunk_size: videoBuffer.byteLength,
          total_chunk_count: 1,
        },
      }),
    }
  );

  if (!initRes.ok) throw new Error(`TikTok upload init failed: ${initRes.status}`);
  const initData = await initRes.json() as TikTokInitUploadResponse;
  if (initData.error?.code !== "ok") {
    throw new Error(`TikTok upload init error: ${initData.error?.message}`);
  }

  const { publish_id, upload_url } = initData.data;

  // Step 2: Upload video chunk
  const uploadRes = await fetch(upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${videoBuffer.byteLength - 1}/${videoBuffer.byteLength}`,
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error(`TikTok video chunk upload failed: ${uploadRes.status}`);

  // Step 3: Poll for completion
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const statusRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id }),
      }
    );
    if (!statusRes.ok) continue;
    const statusData = await statusRes.json() as TikTokStatusResponse;
    if (statusData.data.status === "PUBLISH_COMPLETE") {
      const shareUrl = statusData.data.share_url ?? `https://www.tiktok.com/`;
      return { platformVideoId: publish_id, platformUrl: shareUrl };
    }
    if (statusData.data.status === "FAILED") {
      throw new Error("TikTok video publishing failed");
    }
  }

  throw new Error("TikTok publishing timed out");
}
