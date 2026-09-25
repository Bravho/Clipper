/**
 * The studio's language: the menu's choice, else the phone's, else English —
 * and every studio sentence present, with the same placeholders, in th/en/vi.
 */

import { localeFromLanguages, resolveStudioLocale } from "@/features/device-render/studioText";
import { buildRenderTimeline } from "@/features/device-render/renderTimeline";
import { briefProblems } from "@/features/device-render/editorState";
import { explainRefusal } from "@/lib/mobile/deviceRenderClient";
import { messages, translate, type MessageKey } from "@/i18n/messages";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { Platform } from "@/domain/enums/Platform";

describe("studio language", () => {
  it("reads the first supported language from the phone's list", () => {
    expect(localeFromLanguages(["en-US", "th-TH"])).toBe("en");
    expect(localeFromLanguages(["th-TH"])).toBe("th");
    expect(localeFromLanguages(["vi_VN"])).toBe("vi");
    expect(localeFromLanguages(["ja-JP", "th"])).toBe("th");
    expect(localeFromLanguages(["ja-JP"])).toBeNull();
  });

  it("follows the menu once a language was picked there", () => {
    expect(
      resolveStudioLocale({ appLocale: "th", chosen: true, deviceLanguages: ["en-US"] })
    ).toBe("th");
  });

  it("otherwise follows the phone, and English for a language with no catalogue", () => {
    expect(
      resolveStudioLocale({ appLocale: "th", chosen: false, deviceLanguages: ["en-GB"] })
    ).toBe("en");
    expect(
      resolveStudioLocale({ appLocale: "en", chosen: false, deviceLanguages: ["th-TH"] })
    ).toBe("th");
    expect(
      resolveStudioLocale({ appLocale: "th", chosen: false, deviceLanguages: ["ja-JP"] })
    ).toBe("en");
  });

  it("keeps the app's locale when nothing is known about the phone (server render)", () => {
    expect(resolveStudioLocale({ appLocale: "th", chosen: false, deviceLanguages: null })).toBe(
      "th"
    );
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
