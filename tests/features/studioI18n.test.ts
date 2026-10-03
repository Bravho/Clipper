/**
 * The app's language before a menu choice (the phone's, from Accept-Language),
 * which the studio follows exactly — and every studio sentence present, with the same placeholders, in th/en/vi.
 */

import { localeFromLanguages } from "@/features/device-render/studioText";
import { localeFromAcceptLanguage } from "@/i18n/config";
import { buildRenderTimeline } from "@/features/device-render/renderTimeline";
import { briefProblems } from "@/features/device-render/editorState";
import { explainRefusal } from "@/lib/mobile/deviceRenderClient";
import { messages, translate, type MessageKey } from "@/i18n/messages";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { Platform } from "@/domain/enums/Platform";

describe("app language before anyone picks one (Accept-Language)", () => {
  it("reads the first supported language from a list of tags", () => {
    expect(localeFromLanguages(["en-US", "th-TH"])).toBe("en");
    expect(localeFromLanguages(["th-TH"])).toBe("th");
    expect(localeFromLanguages(["vi_VN"])).toBe("vi");
    expect(localeFromLanguages(["ja-JP", "th"])).toBe("th");
    expect(localeFromLanguages(["ja-JP"])).toBeNull();
  });

  it("follows the phone's language from the header, by preference", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("th-TH,th;q=0.9,en;q=0.8")).toBe("th");
    expect(localeFromAcceptLanguage("en;q=0.5, vi-VN")).toBe("vi");
    expect(localeFromAcceptLanguage("ja-JP,th;q=0.4")).toBe("th");
  });

  it("uses English for a language with no catalogue, and Thai with no header", () => {
    expect(localeFromAcceptLanguage("ja-JP,ja;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("th");
    expect(localeFromAcceptLanguage("")).toBe("th");
  });
});

describe("studio catalogues", () => {
  const studioKeys = (Object.keys(messages.en) as MessageKey[]).filter((key) =>
    key.startsWith("studio.")
  );
  const placeholders = (text: string) => (text.match(/\{[a-z]+\}/gi) ?? []).sort();

  it("has every studio sentence in Thai, English and Vietnamese, with the same placeholders", () => {
    expect(studioKeys.length).toBeGreaterThan(400);
    for (const key of studioKeys) {
      for (const locale of ["th", "vi"] as const) {
        expect(messages[locale][key]).toBeTruthy();
        expect([key, placeholders(messages[locale][key])]).toEqual([
          key,
          placeholders(messages.en[key]),
        ]);
      }
    }
  });

  it("has a sentence for every pipeline step", () => {
    for (const step of Object.values(VideoGenerationStep)) {
      expect(`studio.pipeline.${step}` in messages.en).toBe(true);
    }
  });

  it("puts the helpers' words into the chosen language, English by default", () => {
    const th = (key: MessageKey, values?: Record<string, string | number>) =>
      translate("th", key, values);
    const brief = {
      clipName: "",
      placeName: "",
      latitude: null,
      longitude: null,
      details: "",
      targetSeconds: 30,
      platforms: [Platform.TikTok],
    };
    expect(briefProblems(brief)[0]).toMatch(/at least 3 characters/);
    expect(briefProblems(brief, th)[0]).toBe(messages.th["studio.brief.problem.name"]);

    const idle = { busy: false, progress: null, paused: false, workAvailable: false };
    const timeline = buildRenderTimeline({
      ...idle,
      pipelineStep: VideoGenerationStep.GeneratingBaseVideo,
      t: th,
    });
    expect(timeline.steps[0].label).toBe(messages.th["studio.part.montage"]);
    expect(timeline.status).toBe(messages.th["studio.timeline.liningUpFirst"]);

    expect(explainRefusal("low_power_mode")).toMatch(/Low Power Mode/);
    expect(explainRefusal("low_power_mode", th)).toBe(
      messages.th["studio.refusal.low_power_mode"]
    );
  });
});
