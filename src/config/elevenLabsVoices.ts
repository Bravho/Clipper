/**
 * The ElevenLabs voices a requester can pick for the voiceover.
 *
 * `id` is ElevenLabs' voice id; it is what is saved on a job
 * (`video_generation_jobs.rvc_voice_model`) and sent by clients, so a released
 * id must never be removed (an old job would fall back to the default voice).
 *
 * `name` is RClipper's own name for the voice, shown in the speaker picker in
 * every language. `gender` is shown next to it.
 *
 * The picker shows each voice as "Name : Female voice" / "Name : Male voice".
 *
 * GENDER "unknown": a voice whose gender is not written here has it read from
 * ElevenLabs at runtime — the voice's `labels.gender` — in `/api/voices`
 * (src/lib/ai/elevenLabsVoiceCatalog.ts); with no label the picker shows the
 * name alone. Every voice's gender is written below (confirmed by Tho on
 * 2026-10-11), so the lookup only matters for a voice added later.
 */
export const ELEVENLABS_FEMALE_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
export const ELEVENLABS_MALE_VOICE_ID = "F7823wtD50WK1gnmgBk5";

export type ElevenLabsVoiceGender = "female" | "male" | "unknown";

export const ELEVENLABS_VOICES = [
  {
    id: ELEVENLABS_FEMALE_VOICE_ID,
    name: "Ploy",
    gender: "female",
    label: "เสียงผู้หญิง",
    description: "เสียงผู้หญิงโทนเป็นมิตร (เสียงเดิม)",
  },
  {
    id: ELEVENLABS_MALE_VOICE_ID,
    name: "Krit",
    gender: "male",
    label: "เสียงผู้ชาย",
    description: "เสียงผู้ชายสำหรับเสียงพากย์ภาษาไทย",
  },
  {
    id: "RIc0VzgLsI8EhceUkZx4",
    name: "Fah",
    gender: "female",
    label: "ฟ้า",
    description: "เสียงผู้หญิง ฟ้า",
  },
  {
    id: "tAV9ucNkXgK2k9TLxWkM",
    name: "Au",
    gender: "male",
    label: "Au",
    description: "เสียงผู้ชาย Au",
  },
  {
    id: "nealpwJT5tCyJFKDzEq8",
    name: "Ing",
    gender: "female",
    label: "อิง",
    description: "เสียงผู้หญิง อิง",
  },
  {
    id: "deCz1h6mjB7HnY2xQz08",
    name: "Jay",
    gender: "male",
    label: "เจ",
    description: "เสียงผู้ชาย เจ",
  },
  {
    id: "MeUerI8vM5Ce2GSTXsRT",
    name: "Mek",
    gender: "male",
    label: "เมฆ",
    description: "เสียงผู้ชาย เมฆ",
  },
] as const satisfies readonly {
  id: string;
  name: string;
  gender: ElevenLabsVoiceGender;
  label: string;
  description: string;
}[];

export type ElevenLabsVoiceId = (typeof ELEVENLABS_VOICES)[number]["id"];

/** Every selectable voice id, for request validation (z.enum takes this). */
export const ELEVENLABS_VOICE_IDS = ELEVENLABS_VOICES.map((voice) => voice.id) as [
  ElevenLabsVoiceId,
  ...ElevenLabsVoiceId[],
];

export const DEFAULT_ELEVENLABS_VOICE_ID: ElevenLabsVoiceId =
  ELEVENLABS_FEMALE_VOICE_ID;

/**
 * The short Thai sentence every voice preview reads, so the voices are compared
 * on the same words. Changing it changes `VOICE_PREVIEW_VERSION`'s meaning:
 * bump the version so cached previews are made again.
 */
export const VOICE_PREVIEW_TEXT =
  "วันนี้จะพาไปชิมเมนูเด็ดของร้านเรา รสชาติเข้มข้น หอมอร่อย บรรยากาศดี มาแล้วต้องลองให้ได้";
export const VOICE_PREVIEW_VERSION = 1;

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
