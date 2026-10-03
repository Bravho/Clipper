import { APP_STORE_URL, PLAY_STORE_URL } from "@/config/studioRollout";
import type { MessageKey } from "@/i18n/messages";

/**
 * App Store / Google Play buttons for the marketing site (server component).
 * Links come from NEXT_PUBLIC_APP_STORE_URL / NEXT_PUBLIC_PLAY_STORE_URL; a
 * store whose URL is not set shows "coming soon" instead of a dead link
 * (see `config/studioRollout.ts`).
 */
export function StoreButtons({
  t,
  align = "center",
}: {
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  align?: "center" | "start";
}) {
  const base =
    "inline-flex min-h-[48px] min-w-[200px] items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors";
  return (
    <div
      className={`flex flex-col items-center gap-3 sm:flex-row ${
        align === "center" ? "sm:justify-center" : "sm:justify-start"
      }`}
    >
      {APP_STORE_URL ? (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} bg-slate-900 text-white hover:bg-slate-700`}
        >
          <span aria-hidden></span> {t("mkt.store.appStore")}
        </a>
      ) : (
        <span className={`${base} cursor-default border border-slate-300 bg-white text-slate-500`}>
          <span aria-hidden></span> {t("mkt.store.appStoreSoon")}
        </span>
      )}
      {PLAY_STORE_URL ? (
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} bg-slate-900 text-white hover:bg-slate-700`}
        >
          <span aria-hidden>▶</span> {t("mkt.store.googlePlay")}
        </a>
      ) : (
        <span className={`${base} cursor-default border border-slate-300 bg-white text-slate-500`}>
          {t("mkt.store.googlePlaySoon")}
        </span>
      )}
    </div>
  );
}
