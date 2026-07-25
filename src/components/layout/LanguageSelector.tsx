"use client";

import { useI18n } from "@/i18n/client";
import type { AppLocale } from "@/i18n/config";
import { useRouter } from "next/navigation";

const LOCALES: Array<{ locale: AppLocale; label: string; showInHeader: boolean }> = [
  { locale: "th", label: "ภาษาไทย", showInHeader: true },
  { locale: "en", label: "English", showInHeader: true },
  // Keep Vietnamese configured so it can be restored without rebuilding its selector behavior.
  { locale: "vi", label: "Tiếng Việt", showInHeader: false },
];

function FlagIcon({ locale }: { locale: AppLocale }) {
  if (locale === "th") {
    return (
      <svg viewBox="0 0 28 18" className="h-4 w-6 rounded-[2px] shadow-sm" aria-hidden="true">
        <path fill="#A51931" d="M0 0h28v18H0z" />
        <path fill="#F4F5F8" d="M0 3h28v12H0z" />
        <path fill="#2D2A4A" d="M0 6h28v6H0z" />
      </svg>
    );
  }

  if (locale === "vi") {
    return (
      <svg viewBox="0 0 28 18" className="h-4 w-6 rounded-[2px] shadow-sm" aria-hidden="true">
        <path fill="#DA251D" d="M0 0h28v18H0z" />
        <path fill="#FF0" d="m14 3.1 1.38 4.24h4.46l-3.61 2.62 1.38 4.24L14 11.58l-3.61 2.62 1.38-4.24-3.61-2.62h4.46z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 28 18" className="h-4 w-6 rounded-[2px] shadow-sm" aria-hidden="true">
      <path fill="#012169" d="M0 0h28v18H0z" />
      <path stroke="#FFF" strokeWidth="4" d="m0 0 28 18M28 0 0 18" />
      <path stroke="#C8102E" strokeWidth="2" d="m0 0 28 18M28 0 0 18" />
      <path fill="#FFF" d="M11 0h6v18h-6zM0 6h28v6H0z" />
      <path fill="#C8102E" d="M12 0h4v18h-4zM0 7h28v4H0z" />
    </svg>
  );
}

export function LanguageSelector() {
  const { locale: selected, setLocale, t } = useI18n();
  const router = useRouter();

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t("language.group")}>
      {LOCALES.filter(({ showInHeader }) => showInHeader).map(({ locale, label }) => (
        <button
          key={locale}
          type="button"
          onClick={() => {
            setLocale(locale);
            router.refresh();
          }}
          className={`rounded border p-1.5 transition ${
            selected === locale
              ? "border-blue-400 bg-blue-500/20 ring-1 ring-blue-400"
              : "border-slate-600 bg-slate-800 hover:border-slate-400 hover:bg-slate-700"
          }`}
          aria-label={label}
          title={label}
          aria-pressed={selected === locale}
        >
          <FlagIcon locale={locale} />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
