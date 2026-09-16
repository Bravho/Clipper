import { formatScriptDocument, parseScriptDocument } from "@/services/studio/scriptDocument";

const script = {
  title: "คลิปทดสอบ",
  mainHook: "ประโยคเปิด",
  hooks: "ขยายประเด็น",
  painPointsOrIntroduction: "ปัญหาและบริบท",
  content: "เนื้อหาหลัก",
  conversion: "จุดเปลี่ยน",
  solution: "ทางออก",
  closing: "สรุปและ CTA",
  sections: [
    { topic: "ปัญหาที่ร้านกำลังเจอ", script: "ช่วงปัญหา" },
    { topic: "จุดที่ควรเปลี่ยน", script: "ช่วงจุดเปลี่ยน" },
    { topic: "ทางเลือกของร้าน", script: "ช่วงทางเลือก" },
    { topic: "เริ่มต้นวันนี้", script: "ช่วงสรุป" },
  ],
};

describe("scriptDocument", () => {
  it("formats 3–4 contextual body sections without title and hook", () => {
    const document = formatScriptDocument(script);

    expect(document).toContain("【1. ปัญหาที่ร้านกำลังเจอ】\nช่วงปัญหา");
    expect(document).toContain("【4. เริ่มต้นวันนี้】\nช่วงสรุป");
    expect(document).not.toContain(script.title);
    expect(document).not.toContain(script.mainHook);
  });

  it("maps the dynamic body back to legacy publishing fields", () => {
    expect(parseScriptDocument(formatScriptDocument(script), {
      title: script.title,
      mainHook: script.mainHook,
    })).toEqual({
      title: script.title,
      mainHook: script.mainHook,
      hooks: "ช่วงปัญหา",
      painPointsOrIntroduction: "ช่วงปัญหา",
      content: "ช่วงจุดเปลี่ยน",
      conversion: "ช่วงจุดเปลี่ยน ช่วงทางเลือก",
      solution: "ช่วงทางเลือก",
      closing: "ช่วงสรุป",
    });
  });
});
