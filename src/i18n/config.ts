export const SUPPORTED_LOCALES = ["th", "en", "vi"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "th";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as AppLocale);
}
