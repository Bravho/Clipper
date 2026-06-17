import { sanitizeThaiVoiceScript } from "@/lib/ai/thaiScriptSanitizer";

describe("sanitizeThaiVoiceScript", () => {
  it("removes English labels before Thai speech", () => {
    expect(sanitizeThaiVoiceScript('Thai: "สวัสดีค่ะ วันนี้มีเมนูใหม่"')).toBe(
      "สวัสดีค่ะ วันนี้มีเมนูใหม่"
    );
  });

  it("removes timing wrappers and list markers that can trigger English pronunciation", () => {
    expect(sanitizeThaiVoiceScript("[3s hook] 1. ลองดูจานนี้ก่อนค่ะ")).toBe(
      "ลองดูจานนี้ก่อนค่ะ"
    );
  });

  it("drops Latin-only prefixes before the first Thai character", () => {
    expect(sanitizeThaiVoiceScript("Hook - Wow! เปิดประสบการณ์รสชาติใหม่")).toBe(
      "เปิดประสบการณ์รสชาติใหม่"
    );
  });

  it("preserves normal Thai script text", () => {
    expect(sanitizeThaiVoiceScript("ร้านนี้ทำสดใหม่ทุกวัน หอมกรอบ อร่อยเต็มคำ")).toBe(
      "ร้านนี้ทำสดใหม่ทุกวัน หอมกรอบ อร่อยเต็มคำ"
    );
  });
});
