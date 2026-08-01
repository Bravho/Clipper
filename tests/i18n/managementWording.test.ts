/**
 * Wording guard for RClipper Management.
 *
 * The product is prepaid and one-time. Subscription language is not merely
 * inaccurate here — it is a compliance problem, because it implies a recurring
 * charge that will never happen. This test makes the rule mechanical rather
 * than a convention someone has to remember during review.
 */

import { messages } from "@/i18n/messages";
import { SUPPORTED_LOCALES } from "@/i18n/config";

/** Substrings that must never appear in a management string, per locale. */
const FORBIDDEN: Record<string, string[]> = {
  en: [
    "subscribe",
    "subscription",
    "renews automatically",
    "auto-renew",
    "auto renew",
    "automatic renewal of",
    "monthly subscription",
    "annual subscription",
    "cancel anytime",
    "next billing",
    "recurring",
  ],
  th: ["สมัครสมาชิก", "ต่ออายุอัตโนมัติ", "ยกเลิกได้ทุกเมื่อ", "เรียกเก็บเงินอัตโนมัติ"],
  vi: ["đăng ký thuê bao", "tự động gia hạn", "hủy bất cứ lúc nào", "thanh toán định kỳ"],
};

/** Wording the product REQUIRES, so the promise is stated, not merely implied. */
const REQUIRED_PHRASES: Record<string, string[]> = {
  en: ["No automatic renewal", "One-time payment"],
  th: ["ไม่มีการต่ออายุอัตโนมัติ", "ชำระครั้งเดียว"],
  vi: ["Không tự động gia hạn", "Thanh toán một lần"],
};

/**
 * The NEGATED forms we deliberately ship, which legitimately contain a
 * forbidden term inside them ("no automatic renewal" contains "automatic
 * renewal"; the Thai and Vietnamese equivalents behave the same way). They are
 * removed before scanning, so the scan tests the remaining prose rather than
 * flagging the very promise we are required to make.
 */
const APPROVED_NEGATIONS: Record<string, string[]> = {
  en: ["no automatic renewal", "will not renew automatically", "one-time payment"],
  th: ["ไม่มีการต่ออายุอัตโนมัติ", "จะไม่ต่ออายุอัตโนมัติ"],
  vi: ["không tự động gia hạn", "sẽ không tự động gia hạn"],
};

function managementEntries(locale: string): [string, string][] {
  const catalog = messages[locale as (typeof SUPPORTED_LOCALES)[number]];
  return Object.entries(catalog).filter(
    ([key]) => key.startsWith("management.") || key === "sidebar.management"
  );
}

/** Lowercase and strip the approved negated phrases before scanning. */
function scannable(locale: string, value: string): string {
  let text = value.toLowerCase();
  for (const negation of APPROVED_NEGATIONS[locale] ?? []) {
    text = text.split(negation.toLowerCase()).join(" ");
  }
  return text;
}

describe("RClipper Management wording", () => {
  it("defines management strings in every supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(managementEntries(locale).length).toBeGreaterThan(10);
    }
  });

  it.each(SUPPORTED_LOCALES)("uses no subscription language in %s", (locale) => {
    const forbidden = FORBIDDEN[locale] ?? [];
    for (const [key, value] of managementEntries(locale)) {
      const text = scannable(locale, value);
      for (const word of forbidden) {
        expect(`${key}: ${text}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it.each(SUPPORTED_LOCALES)("states the no-auto-renewal promise in %s", (locale) => {
    const all = managementEntries(locale)
      .map(([, value]) => value)
      .join(" ");
    for (const phrase of REQUIRED_PHRASES[locale] ?? []) {
      expect(all).toContain(phrase);
    }
  });

  it("keeps every locale catalogue in sync on management keys", () => {
    const enKeys = managementEntries("en").map(([k]) => k).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(managementEntries(locale).map(([k]) => k).sort()).toEqual(enKeys);
    }
  });
});
