/**
 * One place that turns a Channel Management product into display copy.
 *
 * WHY THIS EXISTS. `management_products` stores an English `name` and
 * `description` so the row is readable in a database console, and two different
 * pages were each building their own English strings on top of that. The result
 * was a pricing page that stayed in English no matter which language the header
 * was set to. Every user-visible string for a package now comes from the i18n
 * catalogue via the product's `nameKey` / `descriptionKey`, and both pages call
 * this. The DB text is operational metadata, never shown.
 *
 * The `months` values are interpolated rather than baked into the key so a term
 * can be repriced or added without touching three locale files, and so English
 * gets "1 month" instead of the "1 months" the old inline template produced.
 */

import {
  findManagementProduct,
  managementPriceCredits,
  type ManagementProductDefinition,
} from "@/config/management";
import { REQUESTS_PER_PAID_MONTH } from "@/config/videoPackages";
import type { ManagementProduct } from "@/domain/models/ManagementProduct";
import type { MessageKey } from "@/i18n/messages";

/**
 * The app's `t`, exactly as `getServerI18n` and `useI18n` hand it over.
 *
 * Typed against `MessageKey` rather than `string` on purpose: a helper that took
 * a plain string would silently accept a key that does not exist in the
 * catalogue and render an empty label in production.
 */
type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>
) => string;

export interface PackageCopy {
  name: string;
  description: string;
  /** The one-line "what you actually get" strip on the card. */
  terms: string;
}

/**
 * A duration in the reader's language: "1 month" / "3 months" / "1 year".
 *
 * Thai and Vietnamese have no plural inflection, so their catalogues resolve all
 * three keys to the same shape and only the number varies. English needs the
 * singular, and a year reads better as a year than as 12 months.
 */
export function durationLabel(t: Translate, months: number | null): string {
  if (!months) return "";
  if (months === 12) return t("pricing.term.year");
  if (months === 1) return t("pricing.term.month");
  return t("pricing.term.months", { months });
}

export function managementPackageCopy(
  t: Translate,
  product: Pick<
    ManagementProduct,
    "code" | "productType" | "durationMonths" | "uploadAllowance" | "accessWindowDays"
  > & { videoMonths?: number | null }
): PackageCopy {
  // The catalogue holds the i18n keys; the DB row holds the price and the
  // entitlement terms. Falling back to the DB row's own shape (rather than
  // throwing) keeps an unknown code rendering as something rather than crashing
  // the whole pricing page.
  const definition: ManagementProductDefinition | null = findManagementProduct(
    product.code
  );

  const uploads = product.uploadAllowance ?? 4;
  const days = product.accessWindowDays ?? 30;
  const duration = durationLabel(t, product.durationMonths);

  // The catalogue stores these as plain strings (it must not depend on the i18n
  // module), so the cast is where the two type systems meet. Every key it holds
  // has a matching test in tests/i18n.
  const name = definition ? t(definition.nameKey as MessageKey) : product.code;
  const description = definition
    ? t(definition.descriptionKey as MessageKey, {
        paidTotal: REQUESTS_PER_PAID_MONTH,
        months: product.durationMonths ?? 0,
        uploads,
        days,
      })
    : "";

  const terms =
    product.productType === "single_video"
      ? t("pricing.terms.uploadBundle", { uploads, days })
      : product.videoMonths
        ? t("pricing.terms.bundle", {
            paidTotal: REQUESTS_PER_PAID_MONTH,
            duration,
          })
        : t("pricing.terms.publishing", { duration });

  return { name, description, terms };
}

/** Effective price for a catalogue definition, for pages holding config rows. */
export function definitionPrice(definition: ManagementProductDefinition): number {
  return managementPriceCredits(definition);
}
