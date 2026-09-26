import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import { FREE_REQUESTS_PER_WINDOW, FREE_WINDOW_DAYS } from "@/config/videoPackages";
import { MANAGEMENT_PACKAGES_ON_SALE, managementPriceCredits } from "@/config/management";
import { PACKAGE_TIER_REQUESTS, PACKAGE_TIERS } from "@/config/packageTiers";
import { tierPackageOptions } from "@/features/pricing/tierOptions";
import { StoreButtons } from "@/features/marketing/StoreButtons";

export const metadata: Metadata = { title: "Plans and pricing" };

/**
 * Public pricing, read straight from the same catalogue the in-app pricing page
 * sells from (`config/management.ts`, the Starter and Pro packages), so the
 * marketing site cannot quote a price the app does not charge.
 * Buying happens in the app (or, signed in, on /dashboard/pricing).
 */
export default function PlansPage() {
  const { t } = getServerI18n();

  const card = (
    key: string,
    name: string,
    price: number,
    description: string,
    terms?: string
  ) => (
    <div key={key} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
      <h3 className="mb-1 font-semibold text-slate-900">{name}</h3>
      <p className="mb-3 text-2xl font-bold text-slate-900">
        {t("mkt.plans.price", { price })}
      </p>
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
    <div className="px-4 py-16">
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
              t("mkt.plans.freeBody", { freeTotal: FREE_REQUESTS_PER_WINDOW, days: FREE_WINDOW_DAYS })
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

        <p className="mb-10 text-center text-sm text-slate-500">{t("mkt.plans.credits")}</p>
        <StoreButtons t={t} />
      </div>
    </div>
  );
}
