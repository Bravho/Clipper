import {
  AD_LAB_CONTENT_PURPOSES,
  ALL_OBJECTIVES,
  CONTENT_PURPOSE_OPTIONS,
  DEFAULT_CONTENT_PURPOSE,
  getDirectionLabel,
  getObjectiveLabel,
  getPurposeOptions,
  isObjectiveAllowedFor,
  resolveContentPurpose,
} from "@/services/ad-lab/contentPurpose";

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as jest.Mock;
});

describe("AD_LAB_CONTENT_PURPOSES", () => {
  it("contains advertisement and personal_branding", () => {
    expect(AD_LAB_CONTENT_PURPOSES).toContain("advertisement");
    expect(AD_LAB_CONTENT_PURPOSES).toContain("personal_branding");
    expect(AD_LAB_CONTENT_PURPOSES).toHaveLength(2);
  });
});

describe("CONTENT_PURPOSE_OPTIONS", () => {
  it("has labels for both purposes", () => {
    const values = CONTENT_PURPOSE_OPTIONS.map((o) => o.value);
    expect(values).toContain("advertisement");
    expect(values).toContain("personal_branding");
    expect(CONTENT_PURPOSE_OPTIONS.find((o) => o.value === "advertisement")?.label).toContain("โฆษณา");
    expect(CONTENT_PURPOSE_OPTIONS.find((o) => o.value === "personal_branding")?.label).toContain("แบรนด์บุคคล");
  });
});

describe("DEFAULT_CONTENT_PURPOSE", () => {
  it("is advertisement", () => {
    expect(DEFAULT_CONTENT_PURPOSE).toBe("advertisement");
  });
});

describe("resolveContentPurpose", () => {
  it("returns advertisement for undefined", () => {
    expect(resolveContentPurpose(undefined)).toBe("advertisement");
  });

  it("returns advertisement for null", () => {
    expect(resolveContentPurpose(null)).toBe("advertisement");
  });

  it("returns advertisement for unknown string", () => {
    expect(resolveContentPurpose("unknown_value")).toBe("advertisement");
  });

  it("returns advertisement for advertisement", () => {
    expect(resolveContentPurpose("advertisement")).toBe("advertisement");
  });

  it("returns personal_branding for personal_branding", () => {
    expect(resolveContentPurpose("personal_branding")).toBe("personal_branding");
  });
});

describe("getPurposeOptions - advertisement", () => {
  const opts = getPurposeOptions("advertisement");

  it("includes 15s and 600s durations", () => {
    const values = opts.durations.map((d) => d.value);
    expect(values).toContain("15");
    expect(values).toContain("600");
  });

  it("has awareness/consideration/conversion objectives", () => {
    const values = opts.objectives.map((o) => o.value);
    expect(values).toContain("awareness");
    expect(values).toContain("consideration");
    expect(values).toContain("conversion");
  });

  it("has problem-solution direction", () => {
    expect(opts.directions.some((d) => d.value === "problem-solution")).toBe(true);
  });

  it("defaults to problem-solution / 30 / conversion", () => {
    expect(opts.defaults.presentationDirection).toBe("problem-solution");
    expect(opts.defaults.duration).toBe("30");
    expect(opts.defaults.objective).toBe("conversion");
  });
});

describe("getPurposeOptions - personal_branding", () => {
  const opts = getPurposeOptions("personal_branding");

  it("does not include 15s duration", () => {
    expect(opts.durations.some((d) => d.value === "15")).toBe(false);
  });

  it("includes 30s-180s durations", () => {
    const values = opts.durations.map((d) => d.value);
    expect(values).toContain("30");
    expect(values).toContain("180");
    expect(values).not.toContain("300");
  });

  it("has authority/followers/engagement/leads/community objectives", () => {
    const values = opts.objectives.map((o) => o.value);
    expect(values).toContain("authority");
    expect(values).toContain("followers");
    expect(values).toContain("engagement");
    expect(values).toContain("leads");
    expect(values).toContain("community");
  });

  it("has personal branding directions including story-experience", () => {
    expect(opts.directions.some((d) => d.value === "story-experience")).toBe(true);
    expect(opts.directions.some((d) => d.value === "tips-knowledge")).toBe(true);
    expect(opts.directions.some((d) => d.value === "custom")).toBe(true);
  });

  it("defaults to story-experience / 60 / authority", () => {
    expect(opts.defaults.presentationDirection).toBe("story-experience");
    expect(opts.defaults.duration).toBe("60");
    expect(opts.defaults.objective).toBe("authority");
  });
});

describe("isObjectiveAllowedFor", () => {
  it("allows advertisement objectives for advertisement", () => {
    expect(isObjectiveAllowedFor("advertisement", "awareness")).toBe(true);
    expect(isObjectiveAllowedFor("advertisement", "consideration")).toBe(true);
    expect(isObjectiveAllowedFor("advertisement", "conversion")).toBe(true);
  });

  it("rejects personal_branding objectives for advertisement", () => {
    expect(isObjectiveAllowedFor("advertisement", "authority")).toBe(false);
    expect(isObjectiveAllowedFor("advertisement", "leads")).toBe(false);
    expect(isObjectiveAllowedFor("advertisement", "community")).toBe(false);
  });

  it("allows personal_branding objectives for personal_branding", () => {
    expect(isObjectiveAllowedFor("personal_branding", "authority")).toBe(true);
    expect(isObjectiveAllowedFor("personal_branding", "followers")).toBe(true);
    expect(isObjectiveAllowedFor("personal_branding", "engagement")).toBe(true);
    expect(isObjectiveAllowedFor("personal_branding", "leads")).toBe(true);
    expect(isObjectiveAllowedFor("personal_branding", "community")).toBe(true);
  });

  it("rejects advertisement objectives for personal_branding", () => {
    expect(isObjectiveAllowedFor("personal_branding", "awareness")).toBe(false);
    expect(isObjectiveAllowedFor("personal_branding", "conversion")).toBe(false);
  });

  it("rejects unknown objectives for any purpose", () => {
    expect(isObjectiveAllowedFor("advertisement", "unknown")).toBe(false);
    expect(isObjectiveAllowedFor("personal_branding", "unknown")).toBe(false);
  });
});

describe("ALL_OBJECTIVES", () => {
  it("contains all 8 objective values", () => {
    expect(ALL_OBJECTIVES).toHaveLength(8);
    expect(ALL_OBJECTIVES).toContain("awareness");
    expect(ALL_OBJECTIVES).toContain("conversion");
    expect(ALL_OBJECTIVES).toContain("authority");
    expect(ALL_OBJECTIVES).toContain("community");
  });
});

describe("getObjectiveLabel", () => {
  it("returns Thai label for advertisement objectives", () => {
    expect(getObjectiveLabel("awareness")).toContain("รู้จัก");
    expect(getObjectiveLabel("conversion")).toContain("ซื้อ");
  });

  it("returns Thai label for personal branding objectives", () => {
    expect(getObjectiveLabel("authority")).toContain("ผู้เชี่ยวชาญ");
    expect(getObjectiveLabel("leads")).toContain("ทักมา");
    expect(getObjectiveLabel("community")).toContain("คอมมูนิตี้");
  });

  it("falls back to raw value for unknown objective", () => {
    expect(getObjectiveLabel("unknown_obj")).toBe("unknown_obj");
  });
});

describe("getDirectionLabel", () => {
  it("returns Thai label for advertisement directions", () => {
    expect(getDirectionLabel("problem-solution")).toContain("ปัญหา");
    expect(getDirectionLabel("storytelling")).toContain("เล่าเรื่อง");
  });

  it("returns Thai label for personal branding directions", () => {
    expect(getDirectionLabel("story-experience")).toContain("ประสบการณ์");
    expect(getDirectionLabel("tips-knowledge")).toContain("เคล็ดลับ");
    expect(getDirectionLabel("myth-busting")).toContain("ความเชื่อ");
  });

  it("falls back to raw value for unknown direction", () => {
    expect(getDirectionLabel("some-custom-direction")).toBe("some-custom-direction");
  });
});
