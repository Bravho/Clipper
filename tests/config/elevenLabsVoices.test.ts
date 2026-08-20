import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_FEMALE_VOICE_ID,
  ELEVENLABS_MALE_VOICE_ID,
  ELEVENLABS_VOICES,
  isSupportedElevenLabsVoiceId,
  resolveElevenLabsVoiceId,
} from "@/config/elevenLabsVoices";

describe("ElevenLabs voice catalog", () => {
  it("offers exactly the approved female and male voices", () => {
    expect(ELEVENLABS_VOICES.map((voice) => voice.id)).toEqual([
      ELEVENLABS_FEMALE_VOICE_ID,
      ELEVENLABS_MALE_VOICE_ID,
    ]);
    expect(ELEVENLABS_MALE_VOICE_ID).toBe("F7823wtD50WK1gnmgBk5");
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
});
