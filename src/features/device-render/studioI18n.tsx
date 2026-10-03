"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useI18n } from "@/i18n/client";
import type { AppLocale } from "@/i18n/config";
import { translate } from "@/i18n/messages";
import { studioEnglish, type StudioT } from "./studioText";

export { localeFromLanguages, pipelineStepText, studioEnglish, type StudioT } from "./studioText";

/**
 * The studio's language: EXACTLY the one the hamburger menu shows.
 *
 * The first version followed the phone's language until a language was picked
 * in the menu, and only inside the studio. On an iPad set to English that
 * showed an English studio under a menu (and footer) highlighting Thai — the
 * two disagreed, which read as "the studio ignores the menu" (Joe, 25 Sep).
 * Now there is one answer for the whole app: the language picked in the menu,
 * and until one is picked, the phone's own language, decided on the server
 * from Accept-Language (`getServerLocale`). The studio simply follows it, and
 * switches the moment the menu does. Every word is a `studio.*` key in the
 * three catalogues of `src/i18n/messages.ts`.
 */

interface StudioI18nValue {
  locale: AppLocale;
  t: StudioT;
}

const StudioI18nContext = createContext<StudioI18nValue>({ locale: "en", t: studioEnglish });

export function StudioI18nProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const value = useMemo<StudioI18nValue>(
    () => ({ locale, t: (key, values) => translate(locale, key, values) }),
    [locale]
  );
  return <StudioI18nContext.Provider value={value}>{children}</StudioI18nContext.Provider>;
}

/** The studio's translator. English when there is no provider above. */
export function useStudioT(): StudioT {
  return useContext(StudioI18nContext).t;
}

export function useStudioLocale(): AppLocale {
  return useContext(StudioI18nContext).locale;
}
