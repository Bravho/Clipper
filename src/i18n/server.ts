import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_COOKIE, type AppLocale } from "./config";
import { translate, type MessageKey } from "./messages";

export function getServerLocale(): AppLocale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

export function getServerI18n() {
  const locale = getServerLocale();
  return {
    locale,
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
  };
}
