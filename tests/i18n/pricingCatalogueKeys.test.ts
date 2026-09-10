/**
 * Every i18n key a product catalogue points at must actually exist.
 *
 * `ManagementProductDefinition.nameKey` and `VideoPackageDefinition.nameKey` are
 * typed as plain `string`, because the config modules must not depend on the
 * i18n module. That means the compiler cannot check them, and the pricing page
 * casts them to `MessageKey` to call `t`. A typo there does not fail the build —
 * it renders a blank package name on the page a user pays money from.
 *
 * This is the check that replaces the one the type system cannot do. It runs
 * against all three locales, so a key added to English but forgotten in Thai is
 * caught here rather than by a Thai user seeing an English label.
 */

import { MANAGEMENT_PRODUCTS } from "@/config/management";
import { VIDEO_PACKAGES } from "@/config/videoPackages";
import { messages } from "@/i18n/messages";

const LOCALES = ["th", "en", "vi"] as const;

const catalogueKeys = [
  ...MANAGEMENT_PRODUCTS.flatMap((p) => [p.nameKey, p.descriptionKey]),
  ...VIDEO_PACKAGES.flatMap((p) => [p.nameKey, p.descriptionKey]),
];

describe("product catalogue i18n keys", () => {
  it("points at keys that exist, in every locale", () => {
    const missing: string[] = [];
    for (const locale of LOCALES) {
      const catalogue = messages[locale] as Record<string, string>;
      for (const key of catalogueKeys) {
        if (typeof catalogue[key] !== "string" || catalogue[key].trim() === "") {
          missing.push(`${locale}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives every product its own name key", () => {
    // Two products sharing a name key means one of them is mislabelled on the
    // pricing page, which is exactly the sort of thing nobody notices until a
    // customer buys the wrong package.
    const nameKeys = [
      ...MANAGEMENT_PRODUCTS.map((p) => p.nameKey),
      ...VIDEO_PACKAGES.map((p) => p.nameKey),
    ];
    expect(new Set(nameKeys).size).toBe(nameKeys.length);
  });

  it("covers every pricing-page key in all three locales", () => {
    // The Catalog type already forces en/vi to match th at compile time, but an
    // empty string satisfies the type and renders as nothing.
    const thKeys = Object.keys(messages.th).filter((k) => k.startsWith("pricing."));
    expect(thKeys.length).toBeGreaterThan(0);

    for (const locale of LOCALES) {
      const catalogue = messages[locale] as Record<string, string>;
      const blank = thKeys.filter((k) => !catalogue[k] || catalogue[k].trim() === "");
      expect({ locale, blank }).toEqual({ locale, blank: [] });
    }
  });
});
