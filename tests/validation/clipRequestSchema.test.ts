import {
  clipRequestFormSchema,
  submitClipRequestSchema,
  validateUploadCount,
} from "@/features/requests/validation/clipRequestSchema";
import { Platform } from "@/domain/enums/Platform";
import { MAX_UPLOAD_COUNT } from "@/domain/enums/AssetType";

const validBase = {
  title: "My Great Clip",
  description: "A description that is long enough to pass validation here.",
  targetAudience: "Young adults interested in tech",
  targetPlatforms: [Platform.TikTok],
  preferredStyle: "Dynamic / Energetic",
  preferredLanguage: "English",
};

describe("clipRequestFormSchema", () => {
  it("accepts a valid clip request", () => {
    const result = clipRequestFormSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = clipRequestFormSchema.safeParse({ ...validBase, title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.title).toBeDefined();
    }
  });

  it("rejects title shorter than 3 characters", () => {
    const result = clipRequestFormSchema.safeParse({ ...validBase, title: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects title longer than 100 characters", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      title: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects description shorter than 20 characters", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      description: "Too short.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty targetPlatforms array", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      targetPlatforms: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.targetPlatforms).toBeDefined();
    }
  });

  it("accepts multiple target platforms", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      targetPlatforms: [Platform.TikTok, Platform.Instagram, Platform.YouTube],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid platform value", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      targetPlatforms: ["not_a_platform"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty preferredStyle", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      preferredStyle: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty preferredLanguage", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      preferredLanguage: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short targetAudience", () => {
    const result = clipRequestFormSchema.safeParse({
      ...validBase,
      targetAudience: "abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("submitClipRequestSchema", () => {
  const validSubmit = {
    ...validBase,
    creditConfirmed: true as const,
    rightsConfirmed: true as const,
  };

  it("accepts a valid submission with both confirmations", () => {
    const result = submitClipRequestSchema.safeParse(validSubmit);
    expect(result.success).toBe(true);
  });

  it("rejects if creditConfirmed is false", () => {
    const result = submitClipRequestSchema.safeParse({
      ...validSubmit,
      creditConfirmed: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects if rightsConfirmed is false", () => {
    const result = submitClipRequestSchema.safeParse({
      ...validSubmit,
      rightsConfirmed: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects if creditConfirmed is missing", () => {
    const { creditConfirmed, ...rest } = validSubmit;
    const result = submitClipRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects if rightsConfirmed is missing", () => {
    const { rightsConfirmed, ...rest } = validSubmit;
    const result = submitClipRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("validateUploadCount", () => {
  it("returns null when count is within limit", () => {
    expect(validateUploadCount(0)).toBeNull();
    expect(validateUploadCount(MAX_UPLOAD_COUNT - 1)).toBeNull();
    expect(validateUploadCount(MAX_UPLOAD_COUNT)).toBeNull();
  });

  it("returns error message when count exceeds limit", () => {
    const result = validateUploadCount(MAX_UPLOAD_COUNT + 1);
    expect(result).not.toBeNull();
    expect(result).toContain(String(MAX_UPLOAD_COUNT));
  });

  it(`enforces a limit of ${MAX_UPLOAD_COUNT} files`, () => {
    expect(MAX_UPLOAD_COUNT).toBe(5);
  });
});
