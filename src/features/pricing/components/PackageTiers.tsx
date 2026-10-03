import { PACKAGE_TIER_REQUESTS, PACKAGE_TIERS } from "@/config/packageTiers";
import { PackagePicker } from "@/features/management/components/PackagePicker";
import {
  tierPackageOptions,
  type TierProductRow,
} from "@/features/pricing/tierOptions";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const TIER_NAME: Record<(typeof PACKAGE_TIERS)[number], MessageKey> = {
  starter: "pricing.tier.starter.name",
  pro: "pricing.tier.pro.name",
};
const TIER_BODY: Record<(typeof PACKAGE_TIERS)[number], MessageKey> = {
  starter: "pricing.tier.starter.body",
  pro: "pricing.tier.pro.body",
};

/**
 * The two package tiers, Starter then Pro, each with its four terms.
 *
 * A server component: it localises the cards here and hands them to the
 * client-side PackagePicker, which buys through /api/management/checkout. Used
 * by the pricing page and the Channel Management payments page, so both sell
 * exactly the same packages.
 */
export function PackageTiers({
  t,
  rows,
  balanceCredits,
  returnTo,
  chrome = false,
}: {
  t: Translate;
  rows: readonly TierProductRow[];
  balanceCredits: number;
  returnTo: string;
  /** Show PackagePicker's own balance banner (off where the page has one). */
  chrome?: boolean;
}) {
  return (
    <div className="space-y-10">
      {PACKAGE_TIERS.map((tier, index) => {
        const options = tierPackageOptions(t, rows, tier);
        if (options.length === 0) return null;
        return (
          <section key={tier}>
            <h2 className="text-base font-semibold text-slate-900">{t(TIER_NAME[tier])}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t(TIER_BODY[tier], { videos: PACKAGE_TIER_REQUESTS[tier] })}
            </p>
            <div className="mt-4">
              <PackagePicker
                balanceCredits={balanceCredits}
                returnTo={returnTo}
                // One balance banner is enough: only the first tier may show it.
                chrome={chrome && index === 0}
                products={options}
              />
            </div>
          </section>
        );
      })}
      <p className="text-xs text-slate-400">{t("pricing.tiersFootnote")}</p>
    </div>
  );
}
