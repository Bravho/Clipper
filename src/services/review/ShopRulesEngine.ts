/**
 * ShopRulesEngine — fixed shop rules override AI output.
 *
 * Purpose: deterministic post-processing that enforces shop-specific
 * constraints (menu names, prices, promos) over AI-generated script/captions.
 * AI output is treated as a draft; this engine applies corrections.
 *
 * All functions are pure (no I/O). Unit-testable without a DB.
 */

export interface ShopRules {
  /** Exact menu names as they must appear in content. */
  menuNames?: string[];
  /** Menu prices: { menuName: priceThb } */
  menuPrices?: Record<string, number>;
  /** Active promotions to include. */
  promotions?: string[];
  /** Banned phrases/claims. */
  bannedPhrases?: string[];
}

export interface OverrideResult {
  text: string;
  corrections: Array<{ field: string; original: string; corrected: string; reason: string }>;
}

/** Price regex: matches digits followed by Thai/latin currency words. */
const PRICE_PATTERN = /(\d[\d,]*)\s*(บาท|฿|thb|baht)/gi;

/**
 * Apply fixed shop rules to AI-generated text.
 *
 * Corrections applied:
 * 1. Replace AI-generated prices with the correct shop price for each named menu
 * 2. Remove banned phrases
 * 3. Insert missing mandatory promotions (appends to end, not AI-rewritten)
 *
 * Returns corrected text and a list of corrections for audit trail.
 */
export function applyShopRules(
  text: string,
  rules: ShopRules
): OverrideResult {
  const corrections: OverrideResult['corrections'] = [];
  let result = text;

  // 1. Fix prices for known menu items
  if (rules.menuPrices) {
    for (const [menu, correctPrice] of Object.entries(rules.menuPrices)) {
      // Find the menu name in text (case-insensitive) and the price near it
      const menuEscaped = menu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const menuNearPrice = new RegExp(
        `(${menuEscaped}[^\\n]{0,60}?)(\\d[\\d,]*)\\s*(บาท|฿|THB|baht)`,
        'gi'
      );
      result = result.replace(menuNearPrice, (match, before, foundPrice, unit) => {
        const found = parseInt(foundPrice.replace(/,/g, ''), 10);
        if (found !== correctPrice) {
          corrections.push({
            field: 'price',
            original: `${foundPrice} ${unit}`,
            corrected: `${correctPrice} บาท`,
            reason: `fixed price for ${menu}: ${found} → ${correctPrice}`,
          });
          return `${before}${correctPrice} บาท`;
        }
        return match;
      });
    }
  }

  // 2. Remove banned phrases
  if (rules.bannedPhrases) {
    for (const phrase of rules.bannedPhrases) {
      if (result.includes(phrase)) {
        corrections.push({
          field: 'content',
          original: phrase,
          corrected: '',
          reason: `banned phrase removed: "${phrase}"`,
        });
        result = result.split(phrase).join('');
      }
    }
  }

  for (const name of rules.menuNames ?? []) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\  return { text: result.trim(), corrections };');
    result = result.replace(new RegExp(escaped, 'gi'), name);
    if (!result.includes(name)) result += '\n' + name;
  }
  for (const promo of rules.promotions ?? []) {
    if (!result.includes(promo)) {
      corrections.push({ field: 'promotion', original: '', corrected: promo, reason: 'fixed shop promotion' });
      result += '\n' + promo;
    }
  }
  return { text: result.trim(), corrections };
}

/**
 * Check if AI-generated text contains any price/promo claims that need review.
 * Used by RuleEngine signal extraction.
 */
export function extractPriceSignals(text: string): {
  hasPriceOrPromo: boolean;
  matches: string[];
} {
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  PRICE_PATTERN.lastIndex = 0;
  while ((m = PRICE_PATTERN.exec(text)) !== null) {
    matches.push(m[0]);
  }

  const promoPattern = /ลด\s*\d+\s*%|โปร(?:โมชั่น)?|ซื้อ\s*\d+\s*แถม|ฟรี/gi;
  let pm: RegExpExecArray | null;
  while ((pm = promoPattern.exec(text)) !== null) {
    matches.push(pm[0]);
  }

  return { hasPriceOrPromo: matches.length > 0, matches };
}
