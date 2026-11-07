import { workspaceSchema } from "@/services/ad-lab/workspaceSchema";

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as jest.Mock;
});

const baseDraft = {
  id: "d1", brandId: "b1", mainMessage: "test", detailedContent: "",
  presentationDirection: "problem-solution", objective: "conversion", duration: "30",
  title: "T", mainHook: "H", hooks: "H", painPointsOrIntroduction: "P",
  content: "C", conversion: "CV", solution: "S", closing: "CL",
  channels: ["tiktok"], status: "draft", updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const baseWorkspace = {
  brands: [{
    id: "b1", name: "TestBrand", product: "P", audience: "A",
    promise: "Details", createdAt: "2026-01-01",
  }],
  drafts: [baseDraft],
  results: [],
  publishingPlans: [],
  socialAccounts: [],
  selectedBrandId: "b1",
};

describe("workspaceSchema", () => {
  it("parses a minimal valid workspace", () => {
    const result = workspaceSchema.safeParse(baseWorkspace);
    expect(result.success).toBe(true);
  });

  it("contentPurpose survives parsing when set to advertisement", () => {
    const input = {
      ...baseWorkspace,
      drafts: [{ ...baseDraft, contentPurpose: "advertisement" }],
    };
    const result = workspaceSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.drafts[0].contentPurpose).toBe("advertisement");
    }
  });

  it("contentPurpose survives parsing when set to personal_branding", () => {
    const input = {
      ...baseWorkspace,
      drafts: [{ ...baseDraft, contentPurpose: "personal_branding" }],
    };
    const result = workspaceSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.drafts[0].contentPurpose).toBe("personal_branding");
    }
  });

  it("contentPurpose is optional — old drafts without it parse fine", () => {
    const result = workspaceSchema.safeParse(baseWorkspace);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.drafts[0].contentPurpose).toBeUndefined();
    }
  });

  it("rejects invalid contentPurpose value", () => {
    const input = {
      ...baseWorkspace,
      drafts: [{ ...baseDraft, contentPurpose: "invalid_purpose" }],
    };
    const result = workspaceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("avatar survives parsing when present", () => {
    const avatar = {
      scriptHash: "abc123",
      updatedAt: "2026-01-01T00:00:00.000Z",
      voice: {
        voiceId: "v1", modelId: "m1", chars: 500,
        audioKey: "audio/test.mp3", estCostUsd: 0.05,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      video: {
        provider: "heygen" as const,
        engine: "avatar_iv" as const,
        idempotencyKey: "idem-key-1",
        aspectRatio: "9:16" as const,
        resolution: "1080p" as const,
        status: "ready" as const,
        attempts: 1,
        requestedAt: "2026-01-01T00:00:00.000Z",
        estCostUsd: 0.10,
        videoKey: "video/test.mp4",
      },
    };
    const input = {
      ...baseWorkspace,
      drafts: [{ ...baseDraft, avatar }],
    };
    const result = workspaceSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.drafts[0].avatar?.scriptHash).toBe("abc123");
      expect(result.data.drafts[0].avatar?.voice?.chars).toBe(500);
      expect(result.data.drafts[0].avatar?.video?.status).toBe("ready");
    }
  });

  it("avatar is optional — drafts without it parse fine", () => {
    const result = workspaceSchema.safeParse(baseWorkspace);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.drafts[0].avatar).toBeUndefined();
    }
  });

  it("avatar.video audioAssetId/imageAssetId/assetToken survive parsing", () => {
    const avatar = {
      scriptHash: "abc123",
      updatedAt: "2026-01-01T00:00:00.000Z",
      video: {
        provider: "heygen" as const,
        engine: "avatar_iv" as const,
        idempotencyKey: "idem-key-1",
        aspectRatio: "9:16" as const,
        resolution: "1080p" as const,
        status: "submitting" as const,
        attempts: 1,
        requestedAt: "2026-01-01T00:00:00.000Z",
        estCostUsd: 0.10,
        audioAssetId: "audio-asset-abc",
        imageAssetId: "image-asset-def",
        assetToken: "a".repeat(64),
      },
    };
    const input = { ...baseWorkspace, drafts: [{ ...baseDraft, avatar }] };
    const result = workspaceSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.drafts[0].avatar?.video?.audioAssetId).toBe("audio-asset-abc");
      expect(result.data.drafts[0].avatar?.video?.imageAssetId).toBe("image-asset-def");
      expect(result.data.drafts[0].avatar?.video?.assetToken).toBe("a".repeat(64));
    }
  });

  it("rejects avatar.video with invalid status", () => {
    const input = {
      ...baseWorkspace,
      drafts: [{
        ...baseDraft,
        avatar: {
          scriptHash: "x", updatedAt: "2026-01-01T00:00:00.000Z",
          video: {
            provider: "heygen", engine: "avatar_iv",
            idempotencyKey: "k", aspectRatio: "9:16", resolution: "1080p",
            status: "invalid_status", attempts: 0,
            requestedAt: "2026-01-01T00:00:00.000Z", estCostUsd: 0,
          },
        },
      }],
    };
    const result = workspaceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
