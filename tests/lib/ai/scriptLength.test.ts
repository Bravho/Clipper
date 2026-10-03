import {
  countScriptUnits,
  maxScriptUnits,
  scriptFits,
  trimScriptToFit,
} from "@/lib/ai/scriptLength";

describe("scriptLength", () => {
  it("counts Thai letters without stacked vowel/tone marks or spaces", () => {
    // อ า ห า ร ร า น น อ ร อ ย ม า ก = 16
    expect(countScriptUnits("อาหารร้านนี้ อร่อยมาก", "th")).toBe(16);
  });

  it("counts English and Vietnamese by words", () => {
    expect(countScriptUnits("It's served with their signature sauce,", "en")).toBe(6);
    expect(countScriptUnits("Món này rất ngon", "vi")).toBe(4);
  });

  it("sizes the budget to the seconds", () => {
    expect(maxScriptUnits(10, "th")).toBe(80);
    expect(maxScriptUnits(10, "en")).toBe(22);
    expect(maxScriptUnits(10, "vi")).toBe(30);
  });

  it("trims at sentence boundaries and keeps the closing line", () => {
    const text =
      "One two three four five. Six seven eight nine ten. Eleven twelve thirteen fourteen. Come visit us.";
    const trimmed = trimScriptToFit(text, 5, "en"); // 11 words
    expect(scriptFits(trimmed, 5, "en")).toBe(true);
    expect(trimmed.endsWith("Come visit us.")).toBe(true);
    expect(trimmed.startsWith("One two three")).toBe(true);
  });

  it("leaves a script that fits untouched", () => {
    expect(trimScriptToFit("Short and sweet.", 5, "en")).toBe("Short and sweet.");
  });
});
