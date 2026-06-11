/**
 * elevenLabsTtsService.ts
 *
 * ElevenLabs cloud TTS — current pipeline voice engine (replaces iAppTTS).
 *
 * Differences from the iAppTTS flow:
 *   - No local Python server and no job polling: synthesis is a single
 *     synchronous HTTPS call (~5-15 s), so the caller can run the whole
 *     generate→store flow inline.
 *   - Output is MP3 (44.1 kHz, 128 kbps) rather than WAV.
 *
 * Configuration (src/config/aiTools.ts → AI_CONFIG.elevenLabs):
 *   ELEVENLABS_API_KEY    — required
 *   ELEVENLABS_VOICE_ID   — default: Sarah (EXAVITQu4vr4xnSDxMaL)
 *   ELEVENLABS_TTS_MODEL  — default: eleven_v3 (only model with Thai support)
 *   ELEVENLABS_STABILITY  — default: 0.0 (Creative; 0.5 Natural, 1.0 Robust)
 */

import { AI_CONFIG } from "@/config/aiTools";
import { spacesClient, spacesPublicUrl } from "@/lib/spaces";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const BASE_URL = "https://api.elevenlabs.io/v1";

export interface SynthesizeStoreParams {
  /** Approved Thai script — supports Thai-English code-switching. */
  text: string;
  userId: string;
  requestId: string;
}

export interface StoredVoiceResult {
  storageKey: string;
  storageUrl: string;
  fileSizeBytes: number;
  mimeType: string;
  fileName: string;
}

/**
 * Synthesize the script with ElevenLabs and upload the MP3 to DO Spaces.
 * Throws with a descriptive message on any failure (API key, quota, network).
 */
export async function synthesizeAndStore(
  params: SynthesizeStoreParams
): Promise<StoredVoiceResult> {
  const { apiKey, voiceId, model, stability, languageCode } = AI_CONFIG.elevenLabs;

  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set. Add it to .env.local and restart the dev server."
    );
  }

  const res = await fetch(
    `${BASE_URL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: params.text,
        model_id: model,
        language_code: languageCode,
        voice_settings: { stability },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS error ${res.status}: ${body.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  const storageKey = `voice_recordings/${params.userId}/${params.requestId}/elevenlabs_generated_${Date.now()}.mp3`;
  const bucket = process.env.DO_SPACES_BUCKET!;

  await spacesClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: "audio/mpeg",
      // Unique timestamped key per generation — immutable, cache aggressively.
      CacheControl: "public, max-age=31536000, immutable",
      ACL: "public-read",
    })
  );

  return {
    storageKey,
    storageUrl: spacesPublicUrl(storageKey),
    fileSizeBytes: buffer.byteLength,
    mimeType: "audio/mpeg",
    fileName: "elevenlabs_generated.mp3",
  };
}
