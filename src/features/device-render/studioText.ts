import { messages, translate, type MessageKey } from "@/i18n/messages";

/**
 * The studio's translator, without React, so the pure helpers (editorState,
 * renderTimeline, the device-render client) can take one. They default to
 * English, which keeps every existing caller and test unchanged; the studio
 * passes the one from `useStudioT()` (see studioI18n.tsx).
 */
export type StudioT = (key: MessageKey, values?: Record<string, string | number>) => string;

export const studioEnglish: StudioT = (key, values) => translate("en", key, values);

/** The pipeline step in words, in the studio's language; null for an unknown step. */
export function pipelineStepText(t: StudioT, step: string | null | undefined): string | null {
  if (!step) return null;
  const key = `studio.pipeline.${step}`;
  return key in messages.en ? t(key as MessageKey) : null;
}

/** The first of the phone's languages the app has a catalogue for. */
export { localeFromLanguageList as localeFromLanguages } from "@/i18n/config";
