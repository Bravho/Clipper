"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { AppLocale } from "./config";
import { LOCALE_COOKIE } from "./config";
import { translate, type MessageKey } from "./messages";

interface I18nValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: React.ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale(nextLocale) {
      updateLocale(nextLocale);
      localStorage.setItem("rclipper-locale", nextLocale);
      document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
      document.documentElement.lang = nextLocale;
    },
    t: (key, values) => translate(locale, key, values),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
