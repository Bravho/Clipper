import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { getServerI18n } from "@/i18n/server";

export const metadata: Metadata = {
  title: "Delete your RClipper account",
  description: "Request deletion of an RClipper account and associated data.",
};

export default function DeleteAccountRequestPage() {
  const { t } = getServerI18n();
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold text-slate-900">{t("delPage.title")}</h1>
      <p className="mt-3 text-slate-600">
        {t("delPage.lead")}
      </p>
      <Card className="mt-8">
        <h2 className="font-semibold text-slate-900">{t("delPage.signedInTitle")}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {t("delPage.signedInBody")}
        </p>
        <Link href="/account" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">
          {t("delPage.openAccount")}
        </Link>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold text-slate-900">{t("delPage.cannotTitle")}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {t("delPage.cannotBody")}
        </p>
        <a href="mailto:pillarth@gmail.com?subject=Account%20deletion%20request" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">
          pillarth@gmail.com
        </a>
      </Card>
      <p className="mt-6 text-sm text-slate-500">
        {t("delPage.retention")}
      </p>
    </div>
  );
}
