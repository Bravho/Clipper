export const ELEVENLABS_FEMALE_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
export const ELEVENLABS_MALE_VOICE_ID = "F7823wtD50WK1gnmgBk5";

export const ELEVENLABS_VOICES = [
  {
    id: ELEVENLABS_FEMALE_VOICE_ID,
    gender: "female",
    label: "เสียงผู้หญิง",
    description: "เสียงผู้หญิงโทนเป็นมิตร (เสียงเดิม)",
  },
  {
    id: ELEVENLABS_MALE_VOICE_ID,
    gender: "male",
    label: "เสียงผู้ชาย",
    description: "เสียงผู้ชายสำหรับเสียงพากย์ภาษาไทย",
  },
] as const;

export type ElevenLabsVoiceId = (typeof ELEVENLABS_VOICES)[number]["id"];

export const DEFAULT_ELEVENLABS_VOICE_ID: ElevenLabsVoiceId =
  ELEVENLABS_FEMALE_VOICE_ID;

export function isSupportedElevenLabsVoiceId(
  value: unknown
): value is ElevenLabsVoiceId {
  return ELEVENLABS_VOICES.some((voice) => voice.id === value);
}

/** Empty/legacy jobs continue with the original female voice. */
export function resolveElevenLabsVoiceId(value: unknown): ElevenLabsVoiceId {
  return isSupportedElevenLabsVoiceId(value)
    ? value
    : DEFAULT_ELEVENLABS_VOICE_ID;
}
