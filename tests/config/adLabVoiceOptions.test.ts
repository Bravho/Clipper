import {
  AD_LAB_VOICE_SPEEDS,
  AD_LAB_VOICE_TONES,
  DEFAULT_VOICE_SPEED_ID,
  DEFAULT_VOICE_TONE_ID,
  isValidSpeedId,
  isValidToneId,
  resolveSpeedId,
  resolveToneId,
  getSpeedValue,
  getToneVoiceSettings,
  voiceSettingsKey,
} from "@/config/adLabVoiceOptions";

// ---------------------------------------------------------------------------
// AD_LAB_VOICE_SPEEDS

describe("AD_LAB_VOICE_SPEEDS", () => {
  it("contains exactly 5 ordered entries", () => {
    expect(AD_LAB_VOICE_SPEEDS).toHaveLength(5);
  });

  it("all speeds are within the ElevenLabs supported range 0.7–1.2", () => {
    for (const entry of AD_LAB_VOICE_SPEEDS) {
      expect(entry.speed).toBeGreaterThanOrEqual(0.7);
      expect(entry.speed).toBeLessThanOrEqual(1.2);
    }
  });

  it("has ids: very_slow, slow, normal, fast, very_fast in order", () => {
    expect(AD_LAB_VOICE_SPEEDS.map((s) => s.id)).toEqual([
      "very_slow", "slow", "normal", "fast", "very_fast",
    ]);
  });

  it("normal speed is exactly 1.0", () => {
    const normal = AD_LAB_VOICE_SPEEDS.find((s) => s.id === "normal");
    expect(normal?.speed).toBe(1.0);
  });

  it("speeds increase monotonically", () => {
    const speeds = AD_LAB_VOICE_SPEEDS.map((s) => s.speed);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeGreaterThan(speeds[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// AD_LAB_VOICE_TONES

describe("AD_LAB_VOICE_TONES", () => {
  it("contains exactly 4 entries", () => {
    expect(AD_LAB_VOICE_TONES).toHaveLength(4);
  });

  it("has ids: casual, professional, energetic, warm", () => {
    expect(AD_LAB_VOICE_TONES.map((t) => t.id)).toEqual([
      "casual", "professional", "energetic", "warm",
    ]);
  });

  it("every tone stability is one of the three eleven_v3 presets (0, 0.5, 1)", () => {
    const validStabilities = new Set([0, 0.5, 1]);
    for (const tone of AD_LAB_VOICE_TONES) {
      expect(validStabilities.has(tone.voiceSettings.stability)).toBe(true);
    }
  });

  it("every tone similarity_boost is between 0 and 1 inclusive", () => {
    for (const tone of AD_LAB_VOICE_TONES) {
      expect(tone.voiceSettings.similarity_boost).toBeGreaterThanOrEqual(0);
      expect(tone.voiceSettings.similarity_boost).toBeLessThanOrEqual(1);
    }
  });

  it("every tone style is between 0 and 1 inclusive", () => {
    for (const tone of AD_LAB_VOICE_TONES) {
      expect(tone.voiceSettings.style).toBeGreaterThanOrEqual(0);
      expect(tone.voiceSettings.style).toBeLessThanOrEqual(1);
    }
  });

  it("all tones have use_speaker_boost true", () => {
    for (const tone of AD_LAB_VOICE_TONES) {
      expect(tone.voiceSettings.use_speaker_boost).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Defaults

describe("defaults", () => {
  it("DEFAULT_VOICE_SPEED_ID is slow", () => {
    expect(DEFAULT_VOICE_SPEED_ID).toBe("slow");
  });

  it("DEFAULT_VOICE_TONE_ID is casual", () => {
    expect(DEFAULT_VOICE_TONE_ID).toBe("casual");
  });
});

// ---------------------------------------------------------------------------
// isValidSpeedId / isValidToneId

describe("isValidSpeedId", () => {
  it("returns true for all valid speed ids", () => {
    for (const s of AD_LAB_VOICE_SPEEDS) {
      expect(isValidSpeedId(s.id)).toBe(true);
    }
  });

  it("returns false for unknown string", () => {
    expect(isValidSpeedId("turbo")).toBe(false);
  });

  it("returns false for null / undefined / number", () => {
    expect(isValidSpeedId(null)).toBe(false);
    expect(isValidSpeedId(undefined)).toBe(false);
    expect(isValidSpeedId(1.0)).toBe(false);
  });
});

describe("isValidToneId", () => {
  it("returns true for all valid tone ids", () => {
    for (const t of AD_LAB_VOICE_TONES) {
      expect(isValidToneId(t.id)).toBe(true);
    }
  });

  it("returns false for unknown string", () => {
    expect(isValidToneId("robotic")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveSpeedId / resolveToneId

describe("resolveSpeedId", () => {
  it("passes through a valid id unchanged", () => {
    expect(resolveSpeedId("fast")).toBe("fast");
  });

  it("falls back to DEFAULT_VOICE_SPEED_ID for unknown input", () => {
    expect(resolveSpeedId("turbo")).toBe(DEFAULT_VOICE_SPEED_ID);
    expect(resolveSpeedId(null)).toBe(DEFAULT_VOICE_SPEED_ID);
    expect(resolveSpeedId(undefined)).toBe(DEFAULT_VOICE_SPEED_ID);
  });
});

describe("resolveToneId", () => {
  it("passes through a valid id unchanged", () => {
    expect(resolveToneId("warm")).toBe("warm");
  });

  it("falls back to DEFAULT_VOICE_TONE_ID for unknown input", () => {
    expect(resolveToneId("robot")).toBe(DEFAULT_VOICE_TONE_ID);
    expect(resolveToneId(undefined)).toBe(DEFAULT_VOICE_TONE_ID);
  });
});

// ---------------------------------------------------------------------------
// getSpeedValue / getToneVoiceSettings

describe("getSpeedValue", () => {
  it("returns the correct speed for each id", () => {
    expect(getSpeedValue("very_slow")).toBe(0.75);
    expect(getSpeedValue("slow")).toBe(0.85);
    expect(getSpeedValue("normal")).toBe(1.0);
    expect(getSpeedValue("fast")).toBe(1.1);
    expect(getSpeedValue("very_fast")).toBe(1.2);
  });
});

describe("getToneVoiceSettings", () => {
  it("returns correct presets for casual", () => {
    const s = getToneVoiceSettings("casual");
    expect(s.stability).toBe(0.5);
    expect(s.similarity_boost).toBe(0.75);
    expect(s.style).toBe(0.2);
    expect(s.use_speaker_boost).toBe(true);
  });

  it("returns correct presets for professional", () => {
    const s = getToneVoiceSettings("professional");
    expect(s.stability).toBe(1.0);
    expect(s.style).toBe(0.0);
  });

  it("returns correct presets for energetic", () => {
    const s = getToneVoiceSettings("energetic");
    expect(s.stability).toBe(0.0);
    expect(s.style).toBe(0.6);
  });

  it("returns correct presets for warm", () => {
    const s = getToneVoiceSettings("warm");
    expect(s.stability).toBe(0.5);
    expect(s.style).toBe(0.35);
  });
});

// ---------------------------------------------------------------------------
// voiceSettingsKey

describe("voiceSettingsKey", () => {
  it("returns a string combining speedId and toneId", () => {
    expect(voiceSettingsKey("slow", "casual")).toBe("slow:casual");
    expect(voiceSettingsKey("fast", "energetic")).toBe("fast:energetic");
  });

  it("different combinations produce different keys", () => {
    const keys = new Set([
      voiceSettingsKey("slow", "casual"),
      voiceSettingsKey("fast", "casual"),
      voiceSettingsKey("slow", "professional"),
    ]);
    expect(keys.size).toBe(3);
  });
});
