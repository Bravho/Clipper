import type { Metadata } from "next";
import { getServerI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";
import {
  FREE_REQUESTS_PER_WINDOW,
  FREE_WINDOW_DAYS,
  REQUESTS_PER_PAID_MONTH,
  VIDEO_PACKAGES,
} from "@/config/videoPackages";
import {
  MANAGEMENT_BUNDLE_PRODUCTS,
  MANAGEMENT_PUBLISHING_PRODUCTS,
  managementPriceCredits,
  type ManagementProductDefinition,
} from "@/config/management";
import { managementPackageCopy } from "@/features/pricing/packageCopy";
import { StoreButtons } from "@/features/marketing/StoreButtons";

export const metadata: Metadata = { title: "Plans and pricing" };

/**
 * Public pricing, read straight from the same config the in-app pricing page
 * sells from (`config/videoPackages.ts`, `config/management.ts`), so the
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

  const managementCard = (product: ManagementProductDefinition) => {
    const copy = managementPackageCopy(t, {
      code: product.code,
      productType: product.productType,
      durationMonths: product.durationMonths,
      uploadAllowance: product.uploadAllowance,
      accessWindowDays: product.accessWindowDays,
      videoMonths: product.videoMonths,
    });
    return card(product.code, copy.name, managementPriceCredits(product), copy.description, copy.terms);
  };

  return (
    <div className="px-4 py-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 text-center">
          <h1 className="mb-3 text-3xl font-bold text-slate-900">{t("mkt.plans.title")}</h1>
          <p className="text-slate-600">{t("mkt.plans.body")}</p>
        </header>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-bold text-slate-900">{t("mkt.plans.videos")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {card(
              "free",
              t("mkt.plans.freeName"),
              0,
              t("mkt.plans.freeBody", { freeTotal: FREE_REQUESTS_PER_WINDOW, days: FREE_WINDOW_DAYS })
            )}
            {[...VIDEO_PACKAGES]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((pkg) =>
                card(
                  pkg.code,
                  t(pkg.nameKey as MessageKey),
                  pkg.priceCredits,
                  t(pkg.descriptionKey as MessageKey, { paidTotal: REQUESTS_PER_PAID_MONTH })
                )
              )}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-1 text-xl font-bold text-slate-900">{t("mkt.plans.publishing")}</h2>
          <p className="mb-4 text-sm text-slate-600">{t("mkt.plans.publishingBody")}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {MANAGEMENT_PUBLISHING_PRODUCTS.map(managementCard)}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-1 text-xl font-bold text-slate-900">{t("mkt.plans.bundles")}</h2>
          <p className="mb-4 text-sm text-slate-600">{t("mkt.plans.bundlesBody")}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MANAGEMENT_BUNDLE_PRODUCTS.map(managementCard)}
          </div>
        </section>

        <p className="mb-10 text-center text-sm text-slate-500">{t("mkt.plans.credits")}</p>
        <StoreButtons t={t} />
      </div>
    </div>
  );
}
