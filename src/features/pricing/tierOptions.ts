/**
 * The package cards of one tier (Starter or Pro), for every surface that sells
 * them: the pricing page, the Channel Management payments page and the public
 * /plans page.
 *
 * WHY ONE HELPER. Each surface used to assemble its own list from a different
 * mix of catalogues (video packages, publishing passes, bundles). Now one kind
 * of product is sold, in two tiers, and a single function decides which rows
 * belong to a tier, what they are called and what saving they show — so the
 * three surfaces cannot quote different packages.
 *
 * Prices come from the rows handed in: the DB rows (`listActive()`) on the
 * signed-in pages, which are what checkout charges, or the config catalogue on
 * the public page. Tier membership always comes from the config catalogue,
 * which is where a product's tier is defined.
 */

import { findManagementProduct } from "@/config/management";
import type { PackageTier } from "@/config/packageTiers";
import type { PackageOption } from "@/features/management/components/PackagePicker";
import { managementPackageCopy } from "@/features/pricing/packageCopy";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** The fields a product row must carry to become a card. */
export interface TierProductRow {
  code: string;
  productType: "single_video" | "access_pass";
  durationMonths: number | null;
  uploadAllowance: number | null;
  accessWindowDays: number | null;
  videoMonths: number | null;
  videoRequestsPerMonth?: number | null;
  priceCredits: number;
  fullPriceCredits: number;
}

/** Which tier a product code belongs to, or null for a retired product. */
export function tierOfProduct(code: string): PackageTier | null {
  const definition = findManagementProduct(code);
  return definition?.onSale ? definition.tier : null;
}

/**
 * The cards of one tier, shortest term first. Longer terms carry a badge with
 * what they save against buying the same tier's 1-month package that many
 * times — computed from the prices shown, so it can never claim a saving that
 * does not exist.
 */
export function tierPackageOptions(
  t: Translate,
  rows: readonly TierProductRow[],
  tier: PackageTier
): PackageOption[] {
  const tierRows = rows
    .filter((row) => tierOfProduct(row.code) === tier)
    .sort((a, b) => (a.durationMonths ?? 0) - (b.durationMonths ?? 0));
  const monthly = tierRows.find((row) => row.durationMonths === 1)?.priceCredits ?? null;

  return tierRows.map((row) => {
    const copy = managementPackageCopy(t, {
      code: row.code as never,
      productType: row.productType,
      durationMonths: row.durationMonths,
      uploadAllowance: row.uploadAllowance,
      accessWindowDays: row.accessWindowDays,
      videoMonths: row.videoMonths,
      videoRequestsPerMonth: row.videoRequestsPerMonth ?? null,
    });
    const months = row.durationMonths ?? 0;
    const saving = monthly != null && months > 1 ? monthly * months - row.priceCredits : 0;
    return {
      code: row.code,
      name: copy.name,
      description: copy.description,
      terms: copy.terms,
      productType: row.productType,
      durationMonths: row.durationMonths,
      uploadAllowance: row.uploadAllowance,
      accessWindowDays: row.accessWindowDays,
      videoMonths: row.videoMonths,
      badge: saving > 0 ? t("pricing.bundleSaving", { amount: saving.toLocaleString() }) : null,
      priceCredits: row.priceCredits,
      fullPriceCredits: row.fullPriceCredits,
    };
  });
}
