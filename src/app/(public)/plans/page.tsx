import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/authOptions";
import { ROUTES } from "@/config/routes";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { FREE_REQUESTS_TOTAL } from "@/config/videoPackages";
import { VIDEO_LIFETIME_DAYS } from "@/config/retention";
import { MANAGEMENT_PACKAGES_ON_SALE, managementPriceCredits } from "@/config/management";
import { PACKAGE_TIER_REQUESTS, PACKAGE_TIERS } from "@/config/packageTiers";
import { tierPackageOptions } from "@/features/pricing/tierOptions";
import { PerVideoLimits } from "@/features/pricing/components/PlanLimits";
import { StoreCreditPrices } from "@/features/pricing/components/StoreCreditPrices";
import { StoreButtons } from "@/features/marketing/StoreButtons";
import { parseAppUserAgent } from "@/lib/mobile/appUserAgent";

export const metadata: Metadata = { title: "Plans and pricing" };

/**
 * Public pricing, read straight from the same catalogue the in-app pricing page
 * sells from (`config/management.ts`, the Starter and Pro packages), so the
 * marketing site cannot quote a price the app does not charge.
 *
 * ONE PLATFORM'S PRICES, NEVER A MIX. Packages cost the same number of credits
 * everywhere; what a credit costs in real money depends on where it is bought.
 * The page is rendered for the platform asking, read from the user agent the
 * native shells append (`RClipperNative/<ios|android>`, every build ever
 * shipped — see lib/mobile/appUserAgent.ts):
 *
 *   web      packages in ฿ (1 credit = ฿1, charged by Stripe PromptPay/card).
 *            Buying: sign up / sign in → /dashboard/pricing (unchanged).
 *   ios      packages in credits + the App Store's own credit prices, fetched
 *   android  from StoreKit / Play Billing at runtime (StoreCreditPrices). No
 *            baht figure, no PromptPay/card, no web checkout, no link to the
 *            other store. Buying: sign up / sign in → /dashboard/credits, the
 *            in-app store purchase, which then returns to /dashboard/pricing.
 */
export default async function PlansPage() {
  const { t } = getServerI18n();
  const session = await getServerSession(authOptions);
  const appPlatform = parseAppUserAgent(headers().get("user-agent")).platform;
  const store = appPlatform === "ios" ? "App Store" : "Google Play";

  // Buying needs an account: signed-out visitors sign up or sign in and come
  // back to the signed-in page that sells for their platform. On the web that
  // is the package page (Stripe top-up inside it); in the app it is the store
  // top-up, which hands back to the package page once the credits land.
  const buyPath = appPlatform
    ? `${ROUTES.CREDITS}?returnTo=${encodeURIComponent(ROUTES.PRICING)}`
    : ROUTES.PRICING;
  const buyReturn = encodeURIComponent(buyPath);

  // Web prices are baht (1 credit = ฿1); in the app a package is quoted in
  // credits, because the baht a credit costs there is the store's to state.
  // The free plan reads "Free" everywhere — never "฿0" (Tho, 2026-10-24).
  const priceLabel = (price: number) =>
    price === 0
      ? t("mkt.plans.priceFree")
      : appPlatform
        ? t("mkt.plans.priceCredits", { price: price.toLocaleString() })
        : t("mkt.plans.price", { price });

  const card = (
    key: string,
    name: string,
    price: number,
    description: string,
    terms?: string
  ) => (
    <div key={key} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 font-semibold text-slate-900">{name}</h3>
      <p className="mb-3 text-2xl font-bold text-slate-900">{priceLabel(price)}</p>
      <p className="flex-1 text-sm text-slate-600">{description}</p>
      {terms && <p className="mt-3 text-xs font-medium text-slate-500">{terms}</p>}
    </div>
  );

  // The catalogue rows in the shape the tier helper takes: the price shown is
  // the one charged (launch price when a promotion runs).
  const rows = MANAGEMENT_PACKAGES_ON_SALE.map((p) => ({
    code: p.code,
    productType: p.productType,
    durationMonths: p.durationMonths,
    uploadAllowance: p.uploadAllowance,
    accessWindowDays: p.accessWindowDays,
    videoMonths: p.videoMonths,
    videoRequestsPerMonth: p.videoRequestsPerMonth,
    priceCredits: managementPriceCredits(p),
    fullPriceCredits: p.fullPriceCredits,
  }));
  const tierName: Record<(typeof PACKAGE_TIERS)[number], MessageKey> = {
    starter: "pricing.tier.starter.name",
    pro: "pricing.tier.pro.name",
  };
  const tierBody: Record<(typeof PACKAGE_TIERS)[number], MessageKey> = {
    starter: "pricing.tier.starter.body",
    pro: "pricing.tier.pro.body",
  };

  return (
    <div className="px-4 py-16" data-pricing-platform={appPlatform ?? "web"}>
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 text-center">
          <h1 className="mb-3 text-3xl font-bold text-slate-900">{t("mkt.plans.title")}</h1>
          <p className="text-slate-600">{t("mkt.plans.body")}</p>
        </header>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-slate-900">{t("mkt.plans.freeName")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {card(
              "free",
              t("mkt.plans.freeName"),
              0,
              t("mkt.plans.freeBody", { freeTotal: FREE_REQUESTS_TOTAL, days: VIDEO_LIFETIME_DAYS })
            )}
          </div>
        </section>

        {PACKAGE_TIERS.map((tier) => (
          <section key={tier} className="mb-12">
            <h2 className="mb-1 text-xl font-bold text-slate-900">{t(tierName[tier])}</h2>
            <p className="mb-4 text-sm text-slate-600">
              {t(tierBody[tier], { videos: PACKAGE_TIER_REQUESTS[tier] })}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {tierPackageOptions(t, rows, tier).map((option) =>
                card(
                  option.code,
                  option.name,
                  option.priceCredits,
                  option.description,
                  option.badge ? `${option.terms} · ${option.badge}` : option.terms
                )
              )}
            </div>
          </section>
        ))}

        {/* In the app: what a credit costs in THIS store, priced by the store. */}
        {appPlatform && (
          <section className="mb-12">
            <h2 className="mb-1 text-xl font-bold text-slate-900">
              {t("mkt.plans.storeTitle", { store })}
            </h2>
            <p className="mb-4 text-sm text-slate-600">{t("mkt.plans.storeBody", { store })}</p>
            <StoreCreditPrices platform={appPlatform} />
          </section>
        )}

        <section className="mb-12">
          <PerVideoLimits t={t} />
        </section>

        <section className="mb-12 rounded-2xl border border-blue-100 bg-blue-50 p-6 text-center">
          <h2 className="mb-4 text-xl font-bold text-slate-900">{t("mkt.plans.ctaTitle")}</h2>
          {session?.user ? (
            <Link
              href={buyPath}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-blue-700 px-6 text-sm font-semibold text-white hover:bg-blue-800"
            >
              {appPlatform ? t("mkt.plans.ctaBuyStore", { store }) : t("mkt.plans.ctaBuy")}
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href={`${ROUTES.SIGNUP}?callbackUrl=${buyReturn}`}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-blue-700 px-6 text-sm font-semibold text-white hover:bg-blue-800"
              >
                {t("mkt.plans.ctaSignup")}
              </Link>
              <Link
                href={`${ROUTES.LOGIN}?callbackUrl=${buyReturn}`}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                {t("mkt.plans.ctaLogin")}
              </Link>
            </div>
          )}
        </section>

        {appPlatform ? (
          <p className="mb-10 text-center text-sm text-slate-500">
            {t("mkt.plans.creditsApp", { store })}
          </p>
        ) : (
          <>
            <p className="mb-10 text-center text-sm text-slate-500">{t("mkt.plans.credits")}</p>
            <StoreButtons t={t} />
          </>
        )}
      </div>
    </div>
  );
}
