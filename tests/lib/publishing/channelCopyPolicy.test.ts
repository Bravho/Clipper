import { Platform } from "@/domain/enums/Platform";
import {
  CHANNEL_COPY_POLICIES,
  composeChannelCopy,
  extractInlineHashtags,
  formatHashtagText,
  parseHashtagText,
  resolvePublishingCopyDefaults,
  shapeChannelCopy,
  validateChannelCopy,
} from "@/lib/publishing/channelCopyPolicy";

describe("channelCopyPolicy", () => {
  it("separates generated inline hashtags from the caption body", () => {
    const result = extractInlineHashtags(
      "ร้านอาหารเหนือ บรรยากาศดี #เชียงใหม่ #อาหารเหนือ!"
    );

    expect(result.caption).toBe("ร้านอาหารเหนือ บรรยากาศดี");
    expect(result.hashtags).toEqual(["เชียงใหม่", "อาหารเหนือ"]);
  });

  it("deduplicates and normalizes raw hashtag input", () => {
    expect(parseHashtagText("#Food food, #เชียงใหม่ เชียงใหม่")).toEqual([
      "Food",
      "เชียงใหม่",
    ]);
  });

  it("formats every hashtag with a visible hash prefix", () => {
    expect(formatHashtagText(["restaurant", "#foodie", "Chiangmai"])).toBe(
      "#restaurant #foodie #Chiangmai"
    );
  });

  it("prefills publishing with edited defaults instead of stale channel suggestions", () => {
    expect(
      resolvePublishingCopyDefaults({
        defaultCaption: "Updated caption",
        defaultHashtags: ["updated", "current"],
        fallbackCaption: "Old generated caption",
        fallbackHashtags: ["old", "generated"],
      })
    ).toEqual({
      caption: "Updated caption",
      hashtags: ["updated", "current"],
    });
  });

  it("does not restore stale suggestions after defaults are deliberately cleared", () => {
    expect(
      resolvePublishingCopyDefaults({
        defaultCaption: "",
        defaultHashtags: [],
        fallbackCaption: "Old generated caption",
        fallbackHashtags: ["old"],
      })
    ).toEqual({ caption: "", hashtags: [] });
  });

  it("falls back to generated copy when a video has no defaults yet", () => {
    expect(
      resolvePublishingCopyDefaults({
        defaultCaption: null,
        defaultHashtags: [],
        fallbackCaption: "Generated caption",
        fallbackHashtags: ["generated"],
      })
    ).toEqual({ caption: "Generated caption", hashtags: ["generated"] });
  });

  it("shapes the screenshot-style TikTok copy to one hashtag source and <= 150", () => {
    const shaped = shapeChannelCopy(Platform.TikTok, {
      caption:
        "บ้านไร่ยามเย็น เชียงใหม่ ร้านอาหารเหนือรสชาติต้นตำรับ บรรยากาศดี อาหารอร่อย ต้องมาลอง! " +
        "#บ้านไร่ยามเย็น #เชียงใหม่ #อาหารเหนือ #ข้าวซอย #ขนมจีนน้ำเงี้ยว",
      hashtags: [
        "บ้านไร่ยามเย็น",
        "เชียงใหม่",
        "อาหารเหนือ",
        "ข้าวซอย",
        "ขนมจีนน้ำเงี้ยว",
        "บ้านไร่ยามเย็นเชียงใหม่",
        "ร้านอาหาร",
      ],
    });

    const composed = composeChannelCopy(shaped.caption, shaped.hashtags);
    expect(shaped.caption).not.toContain("#");
    expect(shaped.hashtags).toEqual([
      "บ้านไร่ยามเย็น",
      "เชียงใหม่",
      "อาหารเหนือ",
      "ข้าวซอย",
    ]);
    expect(composed.length).toBeLessThanOrEqual(
      CHANNEL_COPY_POLICIES[Platform.TikTok].combinedMaximum!
    );
    expect(composed.match(/#เชียงใหม่/g)).toHaveLength(1);
  });

  it("removes low-priority hashtags when the tag line consumes the budget", () => {
    const shaped = shapeChannelCopy(Platform.TikTok, {
      caption: "คำบรรยายสั้น",
      hashtags: ["ก".repeat(200), "เชียงใหม่"],
    });

    expect(shaped.hashtags).toHaveLength(0);
    expect(composeChannelCopy(shaped.caption, shaped.hashtags).length).toBeLessThanOrEqual(150);
  });

  it("does not split a UTF-16 surrogate pair when shortening", () => {
    const shaped = shapeChannelCopy(Platform.TikTok, {
      caption: `${"ก".repeat(148)}😀ข้อความต่อท้าย`,
      hashtags: [],
    });

    expect(shaped.caption.length).toBeLessThanOrEqual(150);
    expect(shaped.caption).not.toContain("\ud83d…");
    expect(shaped.caption.endsWith("…")).toBe(true);
  });

  it("reports edited TikTok copy over the combined policy", () => {
    const invalid = validateChannelCopy(Platform.TikTok, {
      caption: "ก".repeat(145),
      hashtags: ["เชียงใหม่"],
    });
    const valid = validateChannelCopy(Platform.TikTok, {
      caption: "ก".repeat(130),
      hashtags: ["เชียงใหม่"],
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.combinedLength).toBeGreaterThan(150);
    expect(valid.valid).toBe(true);
  });

  it("applies separate YouTube title and description limits", () => {
    const shaped = shapeChannelCopy(Platform.YouTube, {
      title: "T".repeat(120),
      caption: "D".repeat(5100),
      hashtags: Array.from({ length: 20 }, (_, index) => `tag${index}`),
    });

    expect(shaped.title).toHaveLength(100);
    expect(shaped.caption).toHaveLength(5000);
    expect(shaped.hashtags).toHaveLength(15);
    expect(validateChannelCopy(Platform.YouTube, shaped).valid).toBe(true);
  });
});
