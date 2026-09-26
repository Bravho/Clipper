import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { ROUTES } from "@/config/routes";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { StoreButtons } from "@/features/marketing/StoreButtons";

export const metadata: Metadata = { title: "Get the app" };
export const dynamic = "force-dynamic";

/**
 * Where a signed-in requester lands in a web browser once the browser is the
 * marketing site (BROWSER_MARKETING_ONLY; see middleware). Making videos,
 * requests and publishing live in the app; the account, credits and packages
 * can still be managed here.
 */
export default async function GetTheAppPage() {
  const session = await getServerSession(authOptions);
  const { t } = getServerI18n();

  const links: { href: string; label: MessageKey }[] = [
    { href: ROUTES.ACCOUNT, label: "mkt.getApp.account" },
    { href: ROUTES.CREDITS, label: "mkt.getApp.credits" },
    { href: ROUTES.PRICING, label: "mkt.getApp.pricing" },
  ];

  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="mb-4 text-3xl font-bold text-slate-900">{t("mkt.getApp.title")}</h1>
        <p className="mb-8 text-slate-600">{t("mkt.getApp.body")}</p>
        <StoreButtons t={t} />
        {session?.user && (
          <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 text-left">
            <h2 className="mb-2 font-semibold text-slate-900">{t("mkt.getApp.webTitle")}</h2>
            <p className="mb-4 text-sm text-slate-600">{t("mkt.getApp.webBody")}</p>
            <ul className="grid gap-2">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="flex min-h-[44px] items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-blue-700 hover:bg-slate-50"
                  >
                    {t(link.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
