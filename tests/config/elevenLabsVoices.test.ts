import {
  ELEVENLABS_VOICES,
  ELEVENLABS_VOICE_IDS,
  isSupportedElevenLabsVoiceId,
  resolveElevenLabsVoiceId,
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_FEMALE_VOICE_ID,
  ELEVENLABS_MALE_VOICE_ID,
} from "@/config/elevenLabsVoices";
import { normaliseGender, voicePreviewKey } from "@/lib/ai/elevenLabsVoiceCatalog";

describe("ElevenLabs voice catalog", () => {
  it("offers the two original voices and the five added on 2026-10-11", () => {
    expect(ELEVENLABS_VOICE_IDS).toEqual([
      "EXAVITQu4vr4xnSDxMaL",
      "F7823wtD50WK1gnmgBk5",
      "RIc0VzgLsI8EhceUkZx4",
      "tAV9ucNkXgK2k9TLxWkM",
      "nealpwJT5tCyJFKDzEq8",
      "deCz1h6mjB7HnY2xQz08",
      "MeUerI8vM5Ce2GSTXsRT",
    ]);
  });

  it("keeps the existing female voice as the default", () => {
    expect(DEFAULT_ELEVENLABS_VOICE_ID).toBe(ELEVENLABS_FEMALE_VOICE_ID);
    expect(resolveElevenLabsVoiceId(null)).toBe(ELEVENLABS_FEMALE_VOICE_ID);
    expect(resolveElevenLabsVoiceId("")).toBe(ELEVENLABS_FEMALE_VOICE_ID);
  });

  it("accepts only allow-listed voice IDs", () => {
    expect(isSupportedElevenLabsVoiceId(ELEVENLABS_FEMALE_VOICE_ID)).toBe(true);
    expect(isSupportedElevenLabsVoiceId(ELEVENLABS_MALE_VOICE_ID)).toBe(true);
    expect(isSupportedElevenLabsVoiceId("arbitrary-provider-voice")).toBe(false);
  });

  it("gives every voice a unique id and a unique name", () => {
    expect(new Set(ELEVENLABS_VOICES.map((v) => v.id)).size).toBe(ELEVENLABS_VOICES.length);
    expect(new Set(ELEVENLABS_VOICES.map((v) => v.name)).size).toBe(ELEVENLABS_VOICES.length);
  });

  it("accepts every listed voice and falls back to the default for anything else", () => {
    for (const id of ELEVENLABS_VOICE_IDS) expect(isSupportedElevenLabsVoiceId(id)).toBe(true);
    expect(resolveElevenLabsVoiceId("not-a-voice")).toBe(DEFAULT_ELEVENLABS_VOICE_ID);
  });

  it("reads ElevenLabs' gender labels and never guesses", () => {
    expect(normaliseGender("female")).toBe("female");
    expect(normaliseGender("Male")).toBe("male");
    expect(normaliseGender("neutral")).toBe("unknown");
    expect(normaliseGender(undefined)).toBe("unknown");
  });

  it("stores each voice's preview under a versioned key", () => {
    expect(voicePreviewKey("RIc0VzgLsI8EhceUkZx4")).toBe("voice_previews/RIc0VzgLsI8EhceUkZx4_th_v1.mp3");
  });
});
