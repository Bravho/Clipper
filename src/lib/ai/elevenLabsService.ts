import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { buildProcessedVoiceKey } from "@/lib/spacesKeys";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Download the staff voice recording from DO Spaces, send it to ElevenLabs
 * Speech-to-Speech, and upload the converted audio back to DO Spaces.
 *
 * @returns Storage key and public URL of the processed audio.
 */
export async function convertVoice(params: {
  audioStorageKey: string;
  targetVoiceId: string;
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

  // Send to ElevenLabs Speech-to-Speech
  const formData = new FormData();
  formData.append("audio", new Blob([audioBuffer], { type: "audio/mpeg" }), "recording.mp3");
  formData.append("model_id", "eleven_english_sts_v2");
  formData.append("voice_settings", JSON.stringify({ stability: 0.5, similarity_boost: 0.75 }));

  const response = await fetch(
    `${AI_CONFIG.elevenLabs.baseUrl}/v1/speech-to-speech/${params.targetVoiceId}`,
    {
      method: "POST",
      headers: { "xi-api-key": AI_CONFIG.elevenLabs.apiKey },
      body: formData,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${text}`);
  }

  const processedBuffer = Buffer.from(await response.arrayBuffer());

  // Upload processed audio to DO Spaces
  const storageKey = buildProcessedVoiceKey(params.userId, params.requestId);
  await spacesClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: processedBuffer,
      ContentType: "audio/mpeg",
      ACL: "public-read",
    })
  );

  return { storageKey, storageUrl: spacesPublicUrl(storageKey) };
}

/** Fetch available voices from the ElevenLabs library. */
export async function getAvailableVoices(): Promise<
  Array<{ voice_id: string; name: string; preview_url: string }>
> {
  const response = await fetch(`${AI_CONFIG.elevenLabs.baseUrl}/v1/voices`, {
    headers: { "xi-api-key": AI_CONFIG.elevenLabs.apiKey },
  });
  if (!response.ok) throw new Error(`ElevenLabs voices fetch failed: ${response.status}`);
  const data = await response.json() as { voices: Array<{ voice_id: string; name: string; preview_url: string }> };
  return data.voices;
}
