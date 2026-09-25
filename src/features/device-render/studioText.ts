import { isAppLocale, type AppLocale } from "@/i18n/config";
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
export function localeFromLanguages(languages: readonly string[]): AppLocale | null {
  for (const tag of languages) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isAppLocale(base)) return base;
  }
  return null;
}

/**
 * The hamburger menu's choice wins; else the phone's language; else English.
 * With nothing known about the phone (server render), the app's locale.
 */
export function resolveStudioLocale(input: {
  appLocale: AppLocale;
  chosen: boolean;
  deviceLanguages: readonly string[] | null;
}): AppLocale {
  if (input.chosen) return input.appLocale;
  if (!input.deviceLanguages || input.deviceLanguages.length === 0) return input.appLocale;
  return localeFromLanguages(input.deviceLanguages) ?? "en";
}
