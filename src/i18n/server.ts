import { cookies, headers } from "next/headers";
import { isAppLocale, localeFromAcceptLanguage, LOCALE_COOKIE, type AppLocale } from "./config";
import { translate, type MessageKey } from "./messages";

/**
 * The language picked in the menu (the cookie); until one is picked, the
 * phone's own language (Accept-Language). One answer for the whole app — the
 * menu's highlighted flag, the pages and the studio always agree.
 */
export function getServerLocale(): AppLocale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  if (isAppLocale(value)) return value;
  return localeFromAcceptLanguage(headers().get("accept-language"));
}

export function getServerI18n() {
  const locale = getServerLocale();
  return {
    locale,
    t: (key: MessageKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
  };
}
