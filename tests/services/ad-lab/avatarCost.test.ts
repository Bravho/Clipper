import {
  ELEVENLABS_V3_MAX_CHARS,
  ELEVENLABS_V3_USD_PER_1K_CHARS,
  HEYGEN_AVATAR_IV_PHOTO_USD_PER_SEC,
  HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC,
  THAI_CHARS_PER_SECOND,
  avatarMaxSeconds,
  estimateAvatarVideoCostUsd,
  estimateSpeechSeconds,
  estimateVoiceCostUsd,
} from "@/services/ad-lab/avatarCost";

// No network in tests: any accidental fetch throws.
beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
});

describe("avatarCost constants", () => {
  it("has expected ElevenLabs and Thai-rate values", () => {
    expect(ELEVENLABS_V3_USD_PER_1K_CHARS).toBe(0.08);
    expect(THAI_CHARS_PER_SECOND).toBe(13);
    expect(ELEVENLABS_V3_MAX_CHARS).toBe(5000);
  });

  it("Avatar V constant is 0.0667 per second", () => {
    expect(HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC).toBe(0.0667);
  });

  it("Avatar IV constant is still exported for backward compat", () => {
    expect(HEYGEN_AVATAR_IV_PHOTO_USD_PER_SEC).toBe(0.05);
  });
});

describe("estimateVoiceCostUsd", () => {
  it("computes cost for 1 000 chars", () => {
    expect(estimateVoiceCostUsd(1000)).toBeCloseTo(0.08);
  });

  it("computes cost for 500 chars", () => {
    expect(estimateVoiceCostUsd(500)).toBeCloseTo(0.04);
  });
});

describe("estimateSpeechSeconds", () => {
  it("returns chars / 13", () => {
    expect(estimateSpeechSeconds(130)).toBeCloseTo(10);
  });
});

describe("estimateAvatarVideoCostUsd", () => {
  it("uses Avatar V rate (0.0667/sec)", () => {
    expect(estimateAvatarVideoCostUsd(60)).toBeCloseTo(60 * 0.0667, 4);
  });

  it("cost formula: seconds * 0.0667", () => {
    expect(estimateAvatarVideoCostUsd(1)).toBeCloseTo(0.0667, 4);
    expect(estimateAvatarVideoCostUsd(10)).toBeCloseTo(0.667, 4);
  });

  it("cost applies to speed-adjusted duration (estimateSpeechSeconds result)", () => {
    const chars = 260;
    const speed = 0.85;
    const seconds = estimateSpeechSeconds(chars, speed);
    const expected = seconds * HEYGEN_AVATAR_V_DIGITAL_TWIN_USD_PER_SEC;
    expect(estimateAvatarVideoCostUsd(seconds)).toBeCloseTo(expected, 6);
  });
});

describe("avatarMaxSeconds", () => {
  const ORIGINAL = process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS;
    } else {
      process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS = ORIGINAL;
    }
  });

  it("defaults to 180 when env is unset", () => {
    delete process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS;
    expect(avatarMaxSeconds()).toBe(180);
  });

  it("respects a custom env value", () => {
    process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS = "300";
    expect(avatarMaxSeconds()).toBe(300);
  });

  it("clamps to minimum of 10", () => {
    process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS = "5";
    expect(avatarMaxSeconds()).toBe(10);
  });

  it("clamps to maximum of 1800", () => {
    process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS = "9999";
    expect(avatarMaxSeconds()).toBe(1800);
  });

  it("falls back to 180 for a non-numeric value", () => {
    process.env.RCLIPPER_AD_LAB_AVATAR_MAX_SECONDS = "abc";
    expect(avatarMaxSeconds()).toBe(180);
  });
});
