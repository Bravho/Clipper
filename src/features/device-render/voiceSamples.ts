"use client";

/**
 * The speaker samples, downloaded ahead of time so ▶ plays at once.
 *
 * Each voice's Thai sample (a few dozen KB) is fetched when the studio opens —
 * long before anyone reaches the speaker list — and kept in memory as an
 * object URL. Pressing ▶ then plays from memory with no network wait. The
 * server sends the samples with a year-long cache and a versioned URL, so a
 * second visit reads them from the app's own HTTP cache.
 *
 * Until a sample has arrived (or if it could not be fetched), playback falls
 * back to the URL itself, which still works — it is just not instant.
 */
import { ELEVENLABS_VOICES, VOICE_PREVIEW_VERSION } from "@/config/elevenLabsVoices";

export function voiceSampleUrl(voiceId: string): string {
  return `/api/voices/${encodeURIComponent(voiceId)}/preview?v=${VOICE_PREVIEW_VERSION}`;
}

const ready = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

/** Fetch every voice's sample into memory; safe to call any number of times. */
export function preloadVoiceSamples(): void {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  for (const voice of ELEVENLABS_VOICES) {
    if (ready.has(voice.id) || pending.has(voice.id)) continue;
    const job = fetch(voiceSampleUrl(voice.id), { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        if (blob.size > 0) ready.set(voice.id, URL.createObjectURL(blob));
      })
      .catch(() => {
        // Not fatal: playback uses the URL directly. Try again next time.
      })
      .finally(() => pending.delete(voice.id));
    pending.set(voice.id, job);
  }
}

/** What to play for a voice's sample: the in-memory copy when it has arrived. */
export function voiceSampleSource(voiceId: string): string {
  return ready.get(voiceId) ?? voiceSampleUrl(voiceId);
}
