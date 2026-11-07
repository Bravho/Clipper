// Tone is applied ONLY through voice_settings presets. eleven_v3 audio tags (e.g. [excited],
// [warm]) are deliberately not used: ElevenLabs notes v3 sometimes speaks a tag aloud, which is
// riskier for Thai, and tags would change the spoken text and its hash used for HeyGen.

export const AD_LAB_VOICE_SPEEDS = [
  { id: "very_slow", label: "ช้ามาก",  speed: 0.75 },
  { id: "slow",      label: "ช้า",     speed: 0.85 },
  { id: "normal",    label: "ปกติ",    speed: 1.0  },
  { id: "fast",      label: "เร็ว",    speed: 1.1  },
  { id: "very_fast", label: "เร็วมาก", speed: 1.2  },
] as const;

export type AdLabVoiceSpeedId = (typeof AD_LAB_VOICE_SPEEDS)[number]["id"];

export const DEFAULT_VOICE_SPEED_ID: AdLabVoiceSpeedId = "slow";

// eleven_v3 stability only accepts three preset values: 0.0 (Creative), 0.5 (Natural), 1.0 (Robust).
// Do not add intermediate values — they are undocumented and may be clamped or rejected silently.
export const AD_LAB_VOICE_TONES = [
  {
    id: "casual",
    label: "เป็นกันเอง",
    voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0.2,  use_speaker_boost: true },
  },
  {
    id: "professional",
    label: "มืออาชีพ",
    voiceSettings: { stability: 1.0, similarity_boost: 0.8,  style: 0.0,  use_speaker_boost: true },
  },
  {
    id: "energetic",
    label: "สดใส/ตื่นเต้น",
    voiceSettings: { stability: 0.0, similarity_boost: 0.75, style: 0.6,  use_speaker_boost: true },
  },
  {
    id: "warm",
    label: "อบอุ่น/จริงใจ",
    voiceSettings: { stability: 0.5, similarity_boost: 0.8,  style: 0.35, use_speaker_boost: true },
  },
] as const;

export type AdLabVoiceToneId = (typeof AD_LAB_VOICE_TONES)[number]["id"];

export const DEFAULT_VOICE_TONE_ID: AdLabVoiceToneId = "casual";

export function isValidSpeedId(value: unknown): value is AdLabVoiceSpeedId {
  return AD_LAB_VOICE_SPEEDS.some((s) => s.id === value);
}

export function isValidToneId(value: unknown): value is AdLabVoiceToneId {
  return AD_LAB_VOICE_TONES.some((t) => t.id === value);
}

export function resolveSpeedId(value: unknown): AdLabVoiceSpeedId {
  return isValidSpeedId(value) ? value : DEFAULT_VOICE_SPEED_ID;
}

export function resolveToneId(value: unknown): AdLabVoiceToneId {
  return isValidToneId(value) ? value : DEFAULT_VOICE_TONE_ID;
}

export function getSpeedValue(id: AdLabVoiceSpeedId): number {
  return AD_LAB_VOICE_SPEEDS.find((s) => s.id === id)!.speed;
}

export function getToneVoiceSettings(id: AdLabVoiceToneId) {
  return AD_LAB_VOICE_TONES.find((t) => t.id === id)!.voiceSettings;
}

/**
 * Stable fingerprint for a (speedId, toneId) pair.
 * Changes when either value changes — used for voice staleness detection.
 * The spoken text hash is kept separate so it is unaffected by speed/tone changes.
 */
export function voiceSettingsKey(speedId: AdLabVoiceSpeedId, toneId: AdLabVoiceToneId): string {
  return `${speedId}:${toneId}`;
}
