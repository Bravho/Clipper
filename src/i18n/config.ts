export const SUPPORTED_LOCALES = ["th", "en", "vi"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "th";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as AppLocale);
}

/** The first of a list of language tags ("en-US", "th") the app has a catalogue for. */
export function localeFromLanguageList(tags: readonly string[]): AppLocale | null {
  for (const tag of tags) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isAppLocale(base)) return base;
  }
  return null;
}

/**
 * The locale for someone who has never picked one in the menu: the phone's (or
 * browser's) own language, from the Accept-Language header — which the Android
 * WebView fills from the system languages and the iOS WKWebView from the app's
 * localisations (CFBundleLocalizations en/th/vi). A language the app has no
 * catalogue for gets English; no header at all keeps the Thai default.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header?.trim()) return DEFAULT_LOCALE;
  const tags = header
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, order };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order)
    .map((entry) => entry.tag);
  return localeFromLanguageList(tags) ?? "en";
}
