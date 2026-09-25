"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n/client";
import { LOCALE_COOKIE, type AppLocale } from "@/i18n/config";
import { translate } from "@/i18n/messages";
import { resolveStudioLocale, studioEnglish, type StudioT } from "./studioText";

export {
  localeFromLanguages,
  pipelineStepText,
  resolveStudioLocale,
  studioEnglish,
  type StudioT,
} from "./studioText";

/**
 * The studio's language.
 *
 * WHICH LANGUAGE. The one picked in the hamburger menu, once someone has picked
 * one. Until then, the phone's own language (Android and iOS both hand it to
 * the WebView as `navigator.languages`), because the app-wide default is Thai
 * and a phone set to English should not open a Thai editor. A phone in a
 * language the app has no catalogue for gets English.
 *
 * Only the studio follows the phone for now (Joe, 25 Sep 2026): the rest of the
 * app keeps its cookie-or-Thai default. Every word is a `studio.*` key in the
 * three catalogues of `src/i18n/messages.ts`.
 */

/** Fired by `I18nProvider.setLocale`, so a choice of the SAME locale still counts. */
export const LOCALE_CHOSEN_EVENT = "rclipper-locale-chosen";

/** Has anyone picked a language in the menu on this device? */
function languageWasChosen(): boolean {
  try {
    if (window.localStorage.getItem("rclipper-locale")) return true;
  } catch {
    // Storage can be blocked; the cookie says the same thing.
  }
  return document.cookie
    .split(";")
    .some((entry) => entry.trim().startsWith(`${LOCALE_COOKIE}=`));
}

function phoneLanguages(): string[] {
  const list = Array.isArray(navigator.languages) ? [...navigator.languages] : [];
  if (list.length === 0 && navigator.language) list.push(navigator.language);
  return list;
}

interface StudioI18nValue {
  locale: AppLocale;
  t: StudioT;
}

const StudioI18nContext = createContext<StudioI18nValue>({ locale: "en", t: studioEnglish });

export function StudioI18nProvider({ children }: { children: ReactNode }) {
  const { locale: appLocale } = useI18n();
  // The first render matches the server's (the app locale); the phone's
  // language is only readable in the browser.
  const [locale, setLocale] = useState<AppLocale>(appLocale);

  useEffect(() => {
    const decide = () =>
      setLocale(
        resolveStudioLocale({
          appLocale,
          chosen: languageWasChosen(),
          deviceLanguages: phoneLanguages(),
        })
      );
    decide();
    // `languagechange`: the phone's language was changed while the app was open.
    window.addEventListener(LOCALE_CHOSEN_EVENT, decide);
    window.addEventListener("languagechange", decide);
    return () => {
      window.removeEventListener(LOCALE_CHOSEN_EVENT, decide);
      window.removeEventListener("languagechange", decide);
    };
  }, [appLocale]);

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

