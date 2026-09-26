import type { Metadata } from "next";
import Image from "next/image";
import { getServerI18n } from "@/i18n/server";
import { StoreButtons } from "@/features/marketing/StoreButtons";

export const metadata: Metadata = { title: "Download the app" };

/** The store links, on their own page (linked from the site and from emails). */
export default function DownloadPage() {
  const { t } = getServerI18n();
  return (
    <section className="px-4 py-20 text-center">
      <div className="mx-auto max-w-xl">
        <Image src="/logo.png" alt="RClipper logo" width={72} height={72} className="mx-auto mb-6 rounded-2xl" />
        <h1 className="mb-4 text-3xl font-bold text-slate-900">{t("mkt.download.title")}</h1>
        <p className="mb-8 text-slate-600">{t("mkt.download.body")}</p>
        <StoreButtons t={t} />
        <p className="mt-8 text-sm text-slate-500">{t("mkt.download.sameAccount")}</p>
      </div>
    </section>
  );
}
