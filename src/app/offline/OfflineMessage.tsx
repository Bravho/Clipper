"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";

/** The offline screen's words, in the language picked in the menu. */
export function OfflineMessage() {
  const { t } = useI18n();
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold text-slate-900">{t("offline.title")}</h1>
      <p className="mb-8 text-slate-500">{t("offline.body")}</p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-6 py-3 font-medium text-white transition hover:bg-slate-800"
      >
        {t("error.retry")}
      </Link>
    </>
  );
}
