import { avatarVideoSettingsSchema, applicableSettings, settingsSummary } from "@/config/heygenVideoOptions";
import { avatarRatePerSec, estimateAvatarVideoCostUsd } from "@/services/ad-lab/avatarCost";

describe("heygenVideoOptions", () => {
  it("schema enforces allowlists and ranges, rejects unknown keys", () => {
    expect(avatarVideoSettingsSchema.safeParse({}).success).toBe(true);
    expect(avatarVideoSettingsSchema.safeParse({ resolution: "720p", fit: "cover", voice_settings: { speed: 0.5, pitch: -50, volume: 0 } }).success).toBe(true);
    expect(avatarVideoSettingsSchema.safeParse({ resolution: "4k" }).success).toBe(false);
    expect(avatarVideoSettingsSchema.safeParse({ background: { type: "color", value: "#12345" } }).success).toBe(false);
    expect(avatarVideoSettingsSchema.safeParse({ voice_settings: { volume: 1.1 } }).success).toBe(false);
    expect(avatarVideoSettingsSchema.safeParse({ motion_prompt: "x".repeat(501) }).success).toBe(false);
    expect(avatarVideoSettingsSchema.safeParse({ callback_url: "https://x" }).success).toBe(false);
  });

  it("applicableSettings drop rules by engine, avatar type and mode", () => {
    const all = { motion_prompt: "m", expressiveness: "high" as const, voice_settings: { speed: 1.2 }, resolution: "1080p" as const };
    expect(applicableSettings(all, { engine: "avatar_iv", avatarType: "digital_twin", mode: "tts" })).toEqual({ voice_settings: { speed: 1.2 } });
    expect(applicableSettings(all, { engine: "avatar_v", avatarType: "digital_twin", mode: "audio" })).toEqual({ motion_prompt: "m" });
    expect(applicableSettings(all, { engine: "avatar_iv", avatarType: "photo_avatar", mode: "tts" })).toEqual({
      motion_prompt: "m", expressiveness: "high", voice_settings: { speed: 1.2 },
    });
    expect(applicableSettings({ voice_settings: { speed: 1, pitch: 0, volume: 1 } }, { engine: "avatar_v", avatarType: "digital_twin", mode: "tts" })).toEqual({});
  });

  it("settingsSummary is compact and empty for defaults", () => {
    expect(settingsSummary({})).toBe("");
    expect(settingsSummary({ resolution: "720p", fit: "contain", background: { type: "color", value: "#ffffff" }, caption: { file_format: "srt", style: "default" } }))
      .toContain("720p");
  });

  it("cost by engine + avatar type (docs/pricing 2026-10-13)", () => {
    expect(avatarRatePerSec("avatar_v", "digital_twin")).toBeCloseTo(0.0667);
    expect(avatarRatePerSec("avatar_iv", "digital_twin")).toBeCloseTo(0.0667);
    expect(avatarRatePerSec("avatar_iv", "photo_avatar")).toBeCloseTo(0.05);
    expect(estimateAvatarVideoCostUsd(10, "avatar_iv", "photo_avatar")).toBeCloseTo(0.5);
  });
});
