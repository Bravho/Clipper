import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/authOptions";
import { getRoleHomePath, ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { isAppUserAgent } from "@/lib/mobile/appUserAgent";
import { isBrowserMarketingOnly } from "@/config/studioRollout";
import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
} from "@/config/videoPackages";
import { ENTRY_PACKAGE, managementPriceCredits } from "@/config/management";
import { PACKAGE_TIER_REQUESTS } from "@/config/packageTiers";
import { StoreButtons } from "@/features/marketing/StoreButtons";

/**
 * The marketing home page — what a web browser sees at rclipper.
 *
 * Videos are made in the app (the studio renders them on the phone), so this
 * page sells the app and sends people to the stores. Inside the app a signed-in
 * user goes straight to their home; in a browser a signed-in requester stays on
 * the marketing page once BROWSER_MARKETING_ONLY is on (their requester pages
 * redirect to "get the app"), admins still go to the admin portal.
 *
 * The previous page is kept in `_to_delete/legacy-web-flow/public-home-page.tsx`.
 */
export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const { t } = getServerI18n();
  const inApp = isAppUserAgent(headers().get("user-agent"));

  if (session?.user) {
    const role = session.user.role as Role;
    if (role !== Role.Requester || inApp || !isBrowserMarketingOnly()) {
      redirect(getRoleHomePath(role));
    }
  } else if (inApp) {
    // Inside the app there is nothing to download: go to sign-in (which links
    // to sign-up).
    redirect(ROUTES.LOGIN);
  }

  // The cheapest package on sale: Starter, 1 month (config/management.ts).
  const entryPrice = managementPriceCredits(ENTRY_PACKAGE);

  const features: { icon: string; title: MessageKey; body: MessageKey }[] = [
    { icon: "📱", title: "mkt.feature.phone.title", body: "mkt.feature.phone.body" },
    { icon: "✍️", title: "mkt.feature.script.title", body: "mkt.feature.script.body" },
    { icon: "🎙️", title: "mkt.feature.voice.title", body: "mkt.feature.voice.body" },
    { icon: "💬", title: "mkt.feature.captions.title", body: "mkt.feature.captions.body" },
    { icon: "📐", title: "mkt.feature.shapes.title", body: "mkt.feature.shapes.body" },
    { icon: "🚀", title: "mkt.feature.publish.title", body: "mkt.feature.publish.body" },
  ];

  const steps: { title: MessageKey; body: MessageKey }[] = [
    { title: "mkt.step1.title", body: "mkt.step1.body" },
    { title: "mkt.step2.title", body: "mkt.step2.body" },
    { title: "mkt.step3.title", body: "mkt.step3.body" },
    { title: "mkt.step4.title", body: "mkt.step4.body" },
  ];

  const audiences: { icon: string; label: MessageKey }[] = [
    { icon: "🍜", label: "mkt.audience.restaurants" },
    { icon: "🏨", label: "mkt.audience.hotels" },
    { icon: "🛶", label: "mkt.audience.tours" },
    { icon: "🛍️", label: "mkt.audience.shops" },
  ];

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 to-white px-4 py-20 text-center text-slate-900 sm:py-24">
        <div className="relative mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-center gap-3">
            <Image src="/logo.png" alt="RClipper logo" width={56} height={56} className="rounded-xl" />
            <span className="text-3xl font-bold tracking-tight text-slate-900">RClipper</span>
          </div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 text-sm font-medium text-blue-800 ring-1 ring-blue-200">
            {t("mkt.hero.eyebrow")}
          </div>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            {t("mkt.hero.title")}
            <br />
            <span className="text-blue-600">{t("mkt.hero.titleAccent")}</span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-700">{t("mkt.hero.body")}</p>
          <StoreButtons t={t} />
          <p className="mt-6 text-sm text-slate-500">
            {t("mkt.hero.free", { freeTotal: FREE_REQUESTS_PER_WINDOW, days: FREE_WINDOW_DAYS })}
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-3 text-center text-3xl font-bold text-slate-900">
            {t("mkt.features.title")}
          </h2>
          <p className="mb-12 text-center text-slate-500">{t("mkt.features.body")}</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                <div className="mb-3 text-3xl" aria-hidden>
                  {feature.icon}
                </div>
                <h3 className="mb-2 font-semibold text-slate-900">{t(feature.title)}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{t(feature.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-200 bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-3xl font-bold text-slate-900">{t("mkt.steps.title")}</h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((item, index) => (
              <div key={item.title} className="flex flex-col gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <h3 className="font-semibold text-slate-900">{t(item.title)}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{t(item.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it is for */}
      <section className="bg-white px-4 py-16 text-center">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-3 text-2xl font-bold text-slate-900">{t("mkt.audience.title")}</h2>
          <p className="mb-10 text-slate-500">{t("mkt.audience.body")}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {audiences.map((audience) => (
              <div key={audience.label} className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-3 text-3xl" aria-hidden>
                  {audience.icon}
                </div>
                <div className="text-sm font-semibold text-slate-900">{t(audience.label)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-slate-200 bg-slate-50 px-4 py-16 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-3 text-2xl font-bold text-slate-900">{t("mkt.pricing.title")}</h2>
          <p className="mb-6 text-slate-600">
            {t("mkt.pricing.body", {
              freeTotal: FREE_REQUESTS_PER_WINDOW,
              days: FREE_WINDOW_DAYS,
              starterTotal: PACKAGE_TIER_REQUESTS.starter,
              proTotal: PACKAGE_TIER_REQUESTS.pro,
              price: entryPrice,
            })}
          </p>
          <Link
            href={ROUTES.PUBLIC_PRICING}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
          >
            {t("mkt.pricing.cta")}
          </Link>
        </div>
      </section>

      {/* Download CTA */}
      <section className="bg-white px-4 py-20 text-center">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-4 text-3xl font-bold text-slate-900">{t("mkt.cta.title")}</h2>
          <p className="mb-8 text-slate-600">{t("mkt.cta.body")}</p>
          <StoreButtons t={t} />
          {!session?.user && (
            <p className="mt-6 text-sm text-slate-500">
              {t("mkt.cta.haveAccount")}{" "}
              <Link href={ROUTES.LOGIN} className="font-medium text-blue-700 hover:underline">
                {t("nav.signIn")}
              </Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
