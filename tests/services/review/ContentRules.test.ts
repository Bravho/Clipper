import { applyShopRules, extractPriceSignals, ShopRules } from '@/services/review/ShopRulesEngine';

describe('ShopRulesEngine.applyShopRules', () => {
  it('corrects wrong price for a menu item', () => {
    const text = 'ข้าวผัด 80 บาท';
    const rules: ShopRules = {
      menuPrices: { 'ข้าวผัด': 75 },
    };
    const { text: result, corrections } = applyShopRules(text, rules);
    expect(result).toContain('75 บาท');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].field).toBe('price');
    expect(corrections[0].reason).toContain('ข้าวผัด');
  });

  it('does not add correction when price already correct', () => {
    const text = 'ข้าวผัด 75 บาท';
    const rules: ShopRules = { menuPrices: { 'ข้าวผัด': 75 } };
    const { corrections } = applyShopRules(text, rules);
    expect(corrections).toHaveLength(0);
  });

  it('removes banned phrases', () => {
    const text = 'ร้านดีที่สุดในโลก อาหารอร่อย';
    const rules: ShopRules = { bannedPhrases: ['ดีที่สุดในโลก'] };
    const { text: result, corrections } = applyShopRules(text, rules);
    expect(result).not.toContain('ดีที่สุดในโลก');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].field).toBe('content');
  });

  it('handles text with no matching menu name without change', () => {
    const text = 'อาหารทะเล 120 บาท';
    const rules: ShopRules = { menuPrices: { 'ข้าวผัด': 75 } };
    const { text: result, corrections } = applyShopRules(text, rules);
    expect(result).toBe(text);
    expect(corrections).toHaveLength(0);
  });

  it('applies multiple corrections in order', () => {
    const text = 'ผัดไทย 100 บาท และ ต้มยำ 150 บาท';
    const rules: ShopRules = {
      menuPrices: { 'ผัดไทย': 90, 'ต้มยำ': 120 },
    };
    const { corrections } = applyShopRules(text, rules);
    expect(corrections).toHaveLength(2);
  });

  it('returns empty corrections for empty rules', () => {
    const text = 'อาหารอร่อยมาก 50 บาท';
    const { corrections } = applyShopRules(text, {});
    expect(corrections).toHaveLength(0);
  });
});

describe('ShopRulesEngine.extractPriceSignals', () => {
  it('detects Thai baht price', () => {
    const { hasPriceOrPromo, matches } = extractPriceSignals('ราคา 150 บาท');
    expect(hasPriceOrPromo).toBe(true);
    expect(matches.some((m) => m.includes('150'))).toBe(true);
  });

  it('detects ฿ symbol price (suffix form)', () => {
    const { hasPriceOrPromo } = extractPriceSignals('ราคา 299 ฿');
    expect(hasPriceOrPromo).toBe(true);
  });

  it('detects promo pattern ลด%', () => {
    const { hasPriceOrPromo, matches } = extractPriceSignals('ลด 20% ทุกเมนู');
    expect(hasPriceOrPromo).toBe(true);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('returns false for clean text', () => {
    const { hasPriceOrPromo } = extractPriceSignals('อาหารอร่อยมากๆ');
    expect(hasPriceOrPromo).toBe(false);
  });
});
