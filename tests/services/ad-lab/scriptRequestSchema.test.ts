import { scriptRequestSchema } from "@/services/ad-lab/scriptRequestSchema";

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as jest.Mock;
});

const baseBrand = {
  id: "b1", name: "TestBrand", product: "Product", audience: "Audience",
  promise: "Details", createdAt: "2026-01-01",
};

const baseInput = {
  mainMessage: "test", detailedContent: "", presentationDirection: "problem-solution",
  objective: "conversion", duration: "30",
};

describe("scriptRequestSchema", () => {
  it("parses a valid advertisement request with defaults", () => {
    const result = scriptRequestSchema.safeParse({ brand: baseBrand, input: baseInput });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input.contentPurpose).toBe("advertisement");
    }
  });

  it("defaults contentPurpose to advertisement when omitted", () => {
    const result = scriptRequestSchema.safeParse({ brand: baseBrand, input: baseInput });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.input.contentPurpose).toBe("advertisement");
    }
  });

  it("accepts personal_branding with a valid personal_branding objective", () => {
    const result = scriptRequestSchema.safeParse({
      brand: baseBrand,
      input: { ...baseInput, contentPurpose: "personal_branding", objective: "authority" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a personal_branding objective with advertisement purpose", () => {
    const result = scriptRequestSchema.safeParse({
      brand: baseBrand,
      input: { ...baseInput, contentPurpose: "advertisement", objective: "authority" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an advertisement objective with personal_branding purpose", () => {
    const result = scriptRequestSchema.safeParse({
      brand: baseBrand,
      input: { ...baseInput, contentPurpose: "personal_branding", objective: "conversion" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown objective value", () => {
    const result = scriptRequestSchema.safeParse({
      brand: baseBrand,
      input: { ...baseInput, objective: "unknown_objective" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid advertisement objectives", () => {
    for (const objective of ["awareness", "consideration", "conversion"]) {
      const result = scriptRequestSchema.safeParse({
        brand: baseBrand,
        input: { ...baseInput, objective },
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid personal_branding objectives", () => {
    for (const objective of ["authority", "followers", "engagement", "leads", "community"]) {
      const result = scriptRequestSchema.safeParse({
        brand: baseBrand,
        input: { ...baseInput, contentPurpose: "personal_branding", objective },
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid duration values", () => {
    for (const duration of ["15", "30", "45", "60", "90", "120", "180", "300", "600"]) {
      const result = scriptRequestSchema.safeParse({
        brand: baseBrand,
        input: { ...baseInput, duration },
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid duration value", () => {
    const result = scriptRequestSchema.safeParse({
      brand: baseBrand,
      input: { ...baseInput, duration: "99" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid contentPurpose value", () => {
    const result = scriptRequestSchema.safeParse({
      brand: baseBrand,
      input: { ...baseInput, contentPurpose: "advertising" },
    });
    expect(result.success).toBe(false);
  });

  describe("duration validation per content purpose", () => {
    const pbBase = {
      ...baseInput,
      contentPurpose: "personal_branding" as const,
      objective: "authority",
    };

    it("accepts all valid personal_branding durations", () => {
      for (const duration of ["30", "45", "60", "90", "120", "180"]) {
        const result = scriptRequestSchema.safeParse({
          brand: baseBrand,
          input: { ...pbBase, duration },
        });
        expect(result.success).toBe(true);
      }
    });

    it("rejects duration 15 for personal_branding", () => {
      const result = scriptRequestSchema.safeParse({
        brand: baseBrand,
        input: { ...pbBase, duration: "15" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects duration 300 for personal_branding", () => {
      const result = scriptRequestSchema.safeParse({
        brand: baseBrand,
        input: { ...pbBase, duration: "300" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects duration 600 for personal_branding", () => {
      const result = scriptRequestSchema.safeParse({
        brand: baseBrand,
        input: { ...pbBase, duration: "600" },
      });
      expect(result.success).toBe(false);
    });

    it("does not restrict advertisement durations 15, 300, 600", () => {
      for (const duration of ["15", "300", "600"]) {
        const result = scriptRequestSchema.safeParse({
          brand: baseBrand,
          input: { ...baseInput, duration },
        });
        expect(result.success).toBe(true);
      }
    });
  });
});
