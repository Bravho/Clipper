/**
 * The speaker picker's catalog, as the server knows it: each voice's name and
 * gender, and a short Thai preview to listen to before choosing.
 *
 * GENDER. Taken from `ELEVENLABS_VOICES` when it is written there; for a voice
 * marked "unknown" it is read once from ElevenLabs (`GET /v1/voices/{id}`,
 * falling back to the shared voice library) and kept in memory for half a
 * day. A lookup that fails leaves "unknown" — the picker then shows the name
 * alone, never a guess.
 *
 * PREVIEWS. ElevenLabs' own preview clips are usually English. A Thai
 * restaurant owner choosing a Thai voiceover needs to hear Thai, so each
 * preview is made once with `VOICE_PREVIEW_TEXT` through the same model and
 * settings the pipeline uses, stored in Spaces under a fixed key, held in
 * memory, and served from the app's own origin. One make per voice per `VOICE_PREVIEW_VERSION`:
 * about ฿0.5 each, once, for the whole app — not per user, not per request.
 * Preview makes are NOT counted as a request's voice makes (they are not
 * stored as a request asset).
 */
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { AI_CONFIG } from "@/config/aiTools";
import {
  ELEVENLABS_VOICES,
  VOICE_PREVIEW_TEXT,
  VOICE_PREVIEW_VERSION,
  type ElevenLabsVoiceGender,
  type ElevenLabsVoiceId,
} from "@/config/elevenLabsVoices";
import { SPACES_BUCKET, spacesClient } from "@/lib/spaces";
import { synthesizeToBuffer } from "@/lib/ai/elevenLabsTtsService";

const BASE_URL = "https://api.elevenlabs.io/v1";
const GENDER_TTL_MS = 12 * 60 * 60 * 1000;

export interface VoiceCatalogEntry {
  id: ElevenLabsVoiceId;
  name: string;
  gender: ElevenLabsVoiceGender;
}

interface CatalogCache {
  genders: Map<string, { gender: ElevenLabsVoiceGender; at: number }>;
  /** Each voice's Thai sample, held in memory once read (a few dozen KB each). */
  previews: Map<string, Promise<Buffer>>;
}

const globalCache = globalThis as unknown as { __rclipperVoiceCatalog?: CatalogCache };
function cache(): CatalogCache {
  globalCache.__rclipperVoiceCatalog ??= { genders: new Map(), previews: new Map() };
  return globalCache.__rclipperVoiceCatalog;
}

/** ElevenLabs' gender label, normalised; anything else is "unknown". */
export function normaliseGender(value: unknown): ElevenLabsVoiceGender {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "female" || text === "woman" || text === "f") return "female";
  if (text === "male" || text === "man" || text === "m") return "male";
  return "unknown";
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  return res.json();
}

async function lookUpGender(voiceId: string): Promise<ElevenLabsVoiceGender> {
  const apiKey = AI_CONFIG.elevenLabs.apiKey;
  if (!apiKey) return "unknown";
  try {
    const voice = (await fetchJson(`${BASE_URL}/voices/${voiceId}`, apiKey)) as {
      labels?: { gender?: string };
    };
    const gender = normaliseGender(voice.labels?.gender);
    if (gender !== "unknown") return gender;
  } catch {
    // Not in this account's voices — try the public library below.
  }
  try {
    const found = (await fetchJson(
      `${BASE_URL}/shared-voices?page_size=5&search=${encodeURIComponent(voiceId)}`,
      apiKey
    )) as { voices?: { voice_id?: string; gender?: string }[] };
    const match = found.voices?.find((voice) => voice.voice_id === voiceId);
    return normaliseGender(match?.gender);
  } catch {
    return "unknown";
  }
}

/** Every selectable voice with its gender, looking up the ones not written down. */
export async function getVoiceCatalog(): Promise<VoiceCatalogEntry[]> {
  const now = Date.now();
  const { genders } = cache();
  return Promise.all(
    ELEVENLABS_VOICES.map(async (voice) => {
      // Widened on purpose: today every voice has a written gender, but one
      // added later may not.
      let gender = voice.gender as ElevenLabsVoiceGender;
      if (gender === "unknown") {
        const cached = genders.get(voice.id);
        if (cached && now - cached.at < GENDER_TTL_MS) {
          gender = cached.gender;
        } else {
          gender = await lookUpGender(voice.id);
          genders.set(voice.id, { gender, at: now });
        }
      }
      return { id: voice.id, name: voice.name, gender };
    })
  );
}

export function voicePreviewKey(voiceId: string): string {
  return `voice_previews/${voiceId}_th_v${VOICE_PREVIEW_VERSION}.mp3`;
}

async function readObject(key: string): Promise<Buffer | null> {
  try {
    const res = await spacesClient.send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/**
 * A voice's Thai sample as MP3 bytes, making it on the first ask.
 *
 * SPEED. The bytes are kept in this server's memory after the first read, so
 * every later ask is answered at once, and the route serves them from the
 * app's own origin with a year-long cache — the app downloads all samples
 * when the studio opens and plays them from memory, so ▶ starts immediately.
 * Concurrent first asks share one make; a failed make is forgotten, so the
 * next ask tries again.
 */
export function getVoicePreviewBytes(voiceId: ElevenLabsVoiceId): Promise<Buffer> {
  const { previews } = cache();
  const existing = previews.get(voiceId);
  if (existing) return existing;

  const key = voicePreviewKey(voiceId);
  const made = (async () => {
    const stored = await readObject(key);
    if (stored && stored.length > 0) return stored;
    const buffer = await synthesizeToBuffer({ text: VOICE_PREVIEW_TEXT, voiceId });
    await spacesClient.send(
      new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
        ACL: "public-read",
      })
    );
    return buffer;
  })();
  previews.set(voiceId, made);
  made.catch(() => previews.delete(voiceId));
  return made;
}

/**
 * Start reading (or making) every voice's sample in the background, so the
 * first person to open the speaker list after a deploy does not wait for
 * ElevenLabs. Called when the catalog is read.
 */
export function warmVoicePreviews(): void {
  for (const voice of ELEVENLABS_VOICES) {
    getVoicePreviewBytes(voice.id).catch((err) =>
      console.error(`[voices] warming the ${voice.name} sample failed:`, err)
    );
  }
}

/** The app's URL for a voice's sample; the version makes it safe to cache forever. */
export function voicePreviewPath(voiceId: string): string {
  return `/api/voices/${encodeURIComponent(voiceId)}/preview?v=${VOICE_PREVIEW_VERSION}`;
}
