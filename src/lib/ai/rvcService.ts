import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { buildProcessedVoiceKey } from "@/lib/spacesKeys";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Download the staff voice recording from DO Spaces, send it to the RVC server
 * on the Mac Mini for voice conversion, then upload the result back to DO Spaces.
 *
 * Uses the synchronous /convert endpoint on the Mac Mini so this call blocks
 * until the conversion is complete (the server handles its own job queue internally).
 */
export async function convertVoice(params: {
  audioStorageKey: string;
  rvcVoiceModel: string;
  userId: string;
  requestId: string;
}): Promise<{ storageKey: string; storageUrl: string }> {
  const bucket = process.env.DO_SPACES_BUCKET!;

  // Download staff recording from DO Spaces
  const getRes = await spacesClient.send(
    new GetObjectCommand({ Bucket: bucket, Key: params.audioStorageKey })
  );
  const chunks: Uint8Array[] = [];
  for await (const chunk of getRes.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const audioBuffer = Buffer.concat(chunks);

  const rvcUrl = AI_CONFIG.rvc.serverUrl;
  if (!rvcUrl) throw new Error("RVC_SERVER_URL is not configured");

  const voiceModel = params.rvcVoiceModel || AI_CONFIG.rvc.defaultVoiceModel;

  // Detect audio format from storage key extension
  const ext = params.audioStorageKey.split(".").pop()?.toLowerCase() ?? "webm";
  const mimeType = ext === "wav" ? "audio/wav" : ext === "mp3" ? "audio/mpeg" : "audio/webm";

  const form = new FormData();
  form.append("audio", new Blob([audioBuffer], { type: mimeType }), `recording.${ext}`);
  form.append("voice_id", voiceModel);

  // POST to /convert — the Mac Mini server waits for RVC to finish before responding
  const response = await fetch(`${rvcUrl}/convert`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(5 * 60 * 1000), // 5-minute timeout
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`RVC server error ${response.status}: ${text}`);
  }

  const processedBuffer = Buffer.from(await response.arrayBuffer());

  // Upload processed audio to DO Spaces
  const storageKey = buildProcessedVoiceKey(params.userId, params.requestId);
  await spacesClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: processedBuffer,
      ContentType: "audio/wav",
      ACL: "public-read",
    })
  );

  return { storageKey, storageUrl: spacesPublicUrl(storageKey) };
}
