/**
 * AdLabAvatarService unit tests.
 * All I/O is injected via the deps object — no real network, S3, or DB.
 */

jest.mock("@/lib/spaces", () => ({
  spacesClient: {},
  SPACES_BUCKET: "test-bucket",
  spacesSendWithRetry: jest.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));
jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn(async () => "https://signed.url/test"),
}));

import { createHmac } from "node:crypto";
import { AdLabAvatarService, AdLabAvatarError, type AdLabAvatarServiceDeps } from "@/services/ad-lab/AdLabAvatarService";
import { HeyGenClient, HeyGenNotConfiguredError, HeyGenApiError, type HeyGenLook } from "@/lib/ai/heygenClient";
import type { AdLabScriptDraft } from "@/domain/models/AdLab";
import { DEFAULT_AD_LAB_AVATAR_VOICE_ID, ELEVENLABS_FEMALE_VOICE_ID } from "@/config/elevenLabsVoices";
import { DEFAULT_VOICE_SPEED_ID, DEFAULT_VOICE_TONE_ID } from "@/config/adLabVoiceOptions";

// ---------------------------------------------------------------------------
// Test fixtures

const DRAFT_APPROVED: AdLabScriptDraft = {
  id: "d1",
  brandId: "b1",
  title: "Test Draft",
  mainMessage: "",
  detailedContent: "",
  presentationDirection: "",
  objective: "conversion",
  duration: "30",
  mainHook: "เปิดด้วย hook",
  hooks: "",
  painPointsOrIntroduction: "",
  content: "เนื้อหาหลัก",
  solution: "",
  conversion: "CTA",
  closing: "",
  channels: ["tiktok"],
  status: "approved",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DRAFT_DRAFT: AdLabScriptDraft = { ...DRAFT_APPROVED, status: "draft" };

// ---------------------------------------------------------------------------
// Shared setup

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
  process.env.NEXTAUTH_SECRET = "test-secret-for-avatar-service";
});

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET;
});

// ---------------------------------------------------------------------------
// Helpers

function makeFakeS3() {
  return {
    send: jest.fn(async (cmd: object) => {
      const name = (cmd as { constructor: { name: string } }).constructor.name;
      if (name === "PutObjectCommand") return {};
      if (name === "HeadObjectCommand") throw Object.assign(new Error("not found"), { name: "NotFound" });
      if (name === "GetObjectCommand") return {
        Body: (async function* () { yield Buffer.from("fake-bytes"); })(),
      };
      return {};
    }),
  };
}

function makeService(overrides: Partial<AdLabAvatarServiceDeps> & {
  loadDraftResult?: AdLabScriptDraft | null;
} = {}) {
  const { loadDraftResult = DRAFT_APPROVED, ...rest } = overrides;
  const fake3 = makeFakeS3();
  return new AdLabAvatarService({
    loadDraft: jest.fn(async () => loadDraftResult),
    synthesize: jest.fn(async () => Buffer.from("mp3-bytes")),
    heygen: () => {
      throw new HeyGenNotConfiguredError();
    },
    s3: fake3 as unknown as import("@aws-sdk/client-s3").S3Client,
    bucket: "test-bucket",
    signUrl: jest.fn(async () => "https://signed.url/test"),
    uploadStream: jest.fn(async () => ({ sizeBytes: 1000 })),
    fetchImpl: jest.fn(() => { throw new Error("network disabled"); }) as unknown as typeof fetch,
    now: () => new Date("2026-10-12T00:00:00.000Z"),
    tokenSecret: () => "test-secret-for-avatar-service",
    elevenLabsConfigured: () => true,
    ...rest,
  });
}

// ---------------------------------------------------------------------------
// getConfig

describe("AdLabAvatarService.getConfig", () => {
  it("returns voice list and rate info", () => {
    const svc = makeService();
    const cfg = svc.getConfig();
    expect(cfg.voices.length).toBeGreaterThan(0);
    expect(cfg.rates.voiceUsdPer1kChars).toBeGreaterThan(0);
    expect(cfg.thaiCharsPerSecond).toBe(13);
    expect(typeof cfg.maxSeconds).toBe("number");
  });

  it("offers exactly the Ad Lab voices with Decha as default", () => {
    const cfg = makeService().getConfig();
    expect(cfg.voices.map((v) => [v.label, v.id])).toEqual([
      ["Decha", "deCz1h6mjB7HnY2xQz08"],
      ["Malee", "mYcpTKg1oj1H5CtzUZNO"],
      ["Chai", "MeUerI8vM5Ce2GSTXsRT"],
      ["Onepen", "RIc0VzgLsI8EhceUkZx4"],
    ]);
    expect(cfg.defaultVoiceId).toBe("deCz1h6mjB7HnY2xQz08");
    for (const v of cfg.voices) expect(v.previewUrl).toMatch(/^\/ad-lab\/voice-previews\/[a-z]+\.mp3$/);
  });
});

describe("AdLabAvatarService.generateVoice allowlist", () => {
  it("rejects the main RClipper female voice, which is not in the Ad Lab list", async () => {
    const svc = makeService();
    await expect(svc.generateVoice("real-user", { draftId: "d1", voiceId: ELEVENLABS_FEMALE_VOICE_ID }))
      .rejects.toMatchObject({ code: "invalid_voice" });
  });
});

// ---------------------------------------------------------------------------
// estimate

describe("AdLabAvatarService.estimate", () => {
  it("throws not_found when draft does not exist", async () => {
    const svc = makeService({ loadDraftResult: null });
    await expect(svc.estimate("u1", "d1")).rejects.toMatchObject({ code: "not_found" });
  });

  it("throws not_approved for a draft draft", async () => {
    const svc = makeService({ loadDraftResult: DRAFT_DRAFT });
    await expect(svc.estimate("u1", "d1")).rejects.toMatchObject({ code: "not_approved" });
  });

  it("returns estimate for an approved draft", async () => {
    const svc = makeService();
    const result = await svc.estimate("u1", "d1");
    expect(result.chars).toBeGreaterThan(0);
    expect(typeof result.scriptHash).toBe("string");
    expect(result.scriptHash).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// generateVoice

describe("AdLabAvatarService.generateVoice", () => {
  it("throws local_account for local dev user", async () => {
    const svc = makeService();
    await expect(svc.generateVoice("studio-local-owner", { draftId: "d1", voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID }))
      .rejects.toMatchObject({ code: "local_account" });
  });

  it("throws not_found when draft is missing", async () => {
    const svc = makeService({ loadDraftResult: null });
    await expect(svc.generateVoice("real-user", { draftId: "d1", voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("throws not_approved for draft status", async () => {
    const svc = makeService({ loadDraftResult: DRAFT_DRAFT });
    await expect(svc.generateVoice("real-user", { draftId: "d1", voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID }))
      .rejects.toMatchObject({ code: "not_approved" });
  });

  it("throws invalid_voice for an unknown voice ID", async () => {
    const svc = makeService();
    await expect(svc.generateVoice("real-user", { draftId: "d1", voiceId: "unknown-voice-id" }))
      .rejects.toMatchObject({ code: "invalid_voice" });
  });

  it("returns voice metadata and signed audio URL on success", async () => {
    const svc = makeService();
    const result = await svc.generateVoice("real-user", { draftId: "d1", voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID });
    expect(result.voice.voiceId).toBe(DEFAULT_AD_LAB_AVATAR_VOICE_ID);
    expect(result.voice.audioKey).toContain("ad_lab/real-user/avatar/d1/");
    expect(result.audioUrl).toBe("https://signed.url/test");
    expect(result.scriptHash).toHaveLength(64);
  });

  it("throws too_long when script exceeds char limit", async () => {
    const longDraft: AdLabScriptDraft = {
      ...DRAFT_APPROVED,
      scriptPlan: "x".repeat(5001),
    };
    const svc = makeService({ loadDraftResult: longDraft });
    await expect(svc.generateVoice("real-user", { draftId: "d1", voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID }))
      .rejects.toMatchObject({ code: "too_long" });
  });
});

// ---------------------------------------------------------------------------
// beginImageUpload

describe("AdLabAvatarService.beginImageUpload", () => {
  it("throws not_found when draft is missing", async () => {
    const svc = makeService({ loadDraftResult: null });
    await expect(svc.beginImageUpload("u1", { draftId: "d1", fileName: "photo.jpg", mimeType: "image/jpeg", fileSizeBytes: 1024 }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("throws invalid_image for unsupported MIME type", async () => {
    const svc = makeService();
    await expect(svc.beginImageUpload("u1", { draftId: "d1", fileName: "photo.gif", mimeType: "image/gif", fileSizeBytes: 1024 }))
      .rejects.toMatchObject({ code: "invalid_image" });
  });

  it("throws invalid_image when file exceeds 10 MB", async () => {
    const svc = makeService();
    await expect(svc.beginImageUpload("u1", { draftId: "d1", fileName: "photo.jpg", mimeType: "image/jpeg", fileSizeBytes: 11 * 1024 * 1024 }))
      .rejects.toMatchObject({ code: "invalid_image" });
  });

  it("returns uploadUrl and imageKey with .jpg extension for JPEG", async () => {
    const svc = makeService();
    const result = await svc.beginImageUpload("u1", { draftId: "d1", fileName: "photo.jpg", mimeType: "image/jpeg", fileSizeBytes: 1024 });
    expect(result.imageKey).toMatch(/^ad_lab\/u1\/avatar\/d1\/image-.*\.jpg$/);
    expect(typeof result.uploadUrl).toBe("string");
  });

  it("returns imageKey with .png extension for PNG", async () => {
    const svc = makeService();
    const result = await svc.beginImageUpload("u1", { draftId: "d1", fileName: "photo.png", mimeType: "image/png", fileSizeBytes: 2048 });
    expect(result.imageKey).toMatch(/\.png$/);
  });

  it("ContentLength is included in the presigned PUT command", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSignedUrl: mockGetSignedUrl } = require("@aws-sdk/s3-request-presigner") as { getSignedUrl: jest.Mock };
    mockGetSignedUrl.mockClear();
    const svc = makeService();
    await svc.beginImageUpload("u1", { draftId: "d1", fileName: "photo.jpg", mimeType: "image/jpeg", fileSizeBytes: 4096 });
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [, cmd] = mockGetSignedUrl.mock.calls[0] as [unknown, { input: { ContentLength: number } }];
    expect(cmd.input.ContentLength).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// prepareVideoAssets (Avatar V — audio only; no image upload)

describe("AdLabAvatarService.prepareVideoAssets", () => {
  const audioKey = "ad_lab/u1/avatar/d1/voice-123.mp3";

  function makeS3WithAudioLength(audioContentLength = 5000) {
    return {
      send: jest.fn(async (cmd: object) => {
        const name = (cmd as { constructor: { name: string } }).constructor.name;
        if (name === "GetObjectCommand") {
          return {
            ContentLength: audioContentLength,
            Body: (async function* () { yield Buffer.from("fake-bytes"); })(),
          };
        }
        return {};
      }),
    };
  }

  it("throws local_account for local dev user", async () => {
    const svc = makeService();
    await expect(svc.prepareVideoAssets("studio-local-owner", { draftId: "d1", audioKey }))
      .rejects.toMatchObject({ code: "local_account" });
  });

  it("throws not_found when draft is missing", async () => {
    const svc = makeService({ loadDraftResult: null });
    await expect(svc.prepareVideoAssets("u1", { draftId: "d1", audioKey }))
      .rejects.toMatchObject({ code: "not_found" });
  });

  it("throws not_approved for draft status", async () => {
    const svc = makeService({ loadDraftResult: DRAFT_DRAFT });
    await expect(svc.prepareVideoAssets("u1", { draftId: "d1", audioKey }))
      .rejects.toMatchObject({ code: "not_approved" });
  });

  it("throws heygen_not_configured when HeyGen is not configured", async () => {
    const fakeS3 = makeS3WithAudioLength();
    const svc = makeService({
      heygen: () => { throw new HeyGenNotConfiguredError(); },
      s3: fakeS3 as unknown as import("@aws-sdk/client-s3").S3Client,
    });
    await expect(svc.prepareVideoAssets("u1", { draftId: "d1", audioKey }))
      .rejects.toMatchObject({ code: "heygen_not_configured" });
  });

  it("throws invalid_key when audioKey belongs to different user", async () => {
    const svc = makeService();
    await expect(svc.prepareVideoAssets("u1", { draftId: "d1", audioKey: "ad_lab/u2/avatar/d1/voice.mp3" }))
      .rejects.toMatchObject({ code: "invalid_key" });
  });

  it("returns audioAssetId and 64-hex assetToken on success (audio-only, no image)", async () => {
    const fakeS3 = makeS3WithAudioLength();
    const fakeHeygen = {
      uploadAsset: jest.fn().mockResolvedValueOnce({ assetId: "audio-asset-123" }),
    };
    const svc = makeService({
      s3: fakeS3 as unknown as import("@aws-sdk/client-s3").S3Client,
      heygen: () => fakeHeygen as unknown as HeyGenClient,
    });
    const result = await svc.prepareVideoAssets("u1", { draftId: "d1", audioKey });
    expect(result.audioAssetId).toBe("audio-asset-123");
    expect(result.assetToken).toMatch(/^[0-9a-f]{64}$/);
    // S3 send called only once for GetObjectCommand (audio)
    const calls = (fakeS3.send as jest.Mock).mock.calls as Array<[{ constructor: { name: string } }]>;
    expect(calls.every(([c]) => c.constructor.name === "GetObjectCommand")).toBe(true);
    expect(fakeHeygen.uploadAsset).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createVideo (Avatar V Digital Twin)

describe("AdLabAvatarService.createVideo", () => {
  const idempotencyKey = "idem-key-12345678";
  const audioAssetId = "audio-asset-id-test";
  const lookId = "lk-twin-test-1";

  function makeValidToken(ownerId = "u1", draftId = "d1"): string {
    // Token is HMAC of "assets|ownerId|draftId|audioAssetId" (no imageAssetId in Avatar V)
    return createHmac("sha256", "test-secret-for-avatar-service")
      .update(`assets|${ownerId}|${draftId}|${audioAssetId}`)
      .digest("hex");
  }

  function makeEligibleLook() {
    return {
      id: lookId,
      name: "My Twin",
      avatarType: "digital_twin",
      supportedApiEngines: ["avatar_v"],
      status: "completed",
    };
  }

  it("throws local_account for local dev user", async () => {
    const svc = makeService();
    await expect(svc.createVideo("studio-local-owner", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: "a".repeat(64), idempotencyKey,
    })).rejects.toMatchObject({ code: "local_account" });
  });

  it("throws invalid_key for bad idempotencyKey format", async () => {
    const svc = makeService();
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey: "short",
    })).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("throws invalid_token for a wrong token", async () => {
    const svc = makeService();
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: "a".repeat(64), idempotencyKey,
    })).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("throws invalid_token for odd-length token", async () => {
    const svc = makeService();
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: "a".repeat(63), idempotencyKey,
    })).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("throws invalid_token for non-hex token", async () => {
    const svc = makeService();
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: "z".repeat(64), idempotencyKey,
    })).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("throws heygen_not_configured when HeyGen factory throws HeyGenNotConfiguredError", async () => {
    const svc = makeService({
      heygen: () => { throw new HeyGenNotConfiguredError(); },
    });
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    })).rejects.toMatchObject({ code: "heygen_not_configured" });
  });

  it("throws look_not_found when getLook returns null", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(null),
      createAvatarVVideo: jest.fn(),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    })).rejects.toMatchObject({ code: "look_not_found" });
  });

  it("renders a non-digital_twin look with avatar_v when it supports avatar_v", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue({ ...makeEligibleLook(), avatarType: "photo_avatar" }),
      createAvatarVVideo: jest.fn().mockResolvedValue({ videoId: "vid-pa", status: "pending" }),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    const result = await svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    });
    expect(result.engine).toBe("avatar_v");
    expect(fakeHeygen.createAvatarVVideo).toHaveBeenCalledWith(expect.objectContaining({ engine: "avatar_v" }));
  });

  it("falls back to avatar_iv (server-chosen) with avatar_iv pricing when avatar_v is unsupported", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue({ ...makeEligibleLook(), supportedApiEngines: ["avatar_iv", "avatar_iii"] }),
      createAvatarVVideo: jest.fn().mockResolvedValue({ videoId: "vid-iv", status: "pending" }),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    const ivResult = await svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    });
    expect(ivResult.engine).toBe("avatar_iv");
    expect(fakeHeygen.createAvatarVVideo).toHaveBeenCalledWith(expect.objectContaining({ engine: "avatar_iv", avatarId: lookId }));

    const vHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLook()),
      createAvatarVVideo: jest.fn().mockResolvedValue({ videoId: "vid-v", status: "pending" }),
    };
    const vResult = await makeService({ heygen: () => vHeygen as unknown as HeyGenClient }).createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    });
    // Pricing (developers.heygen.com/docs/pricing): avatar_iv Digital Twin = avatar_v = $0.0667/s
    expect(ivResult.estCostUsd / vResult.estCostUsd).toBeCloseTo(1, 6);
  });

  it("throws look_not_eligible when the look supports neither avatar_v nor avatar_iv", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue({ ...makeEligibleLook(), supportedApiEngines: ["avatar_iii"] }),
      createAvatarVVideo: jest.fn(),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    })).rejects.toMatchObject({ code: "look_not_eligible" });
    expect(fakeHeygen.createAvatarVVideo).not.toHaveBeenCalled();
  });

  it("throws look_not_eligible when look status is processing (not completed)", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue({ ...makeEligibleLook(), status: "processing" }),
      createAvatarVVideo: jest.fn(),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    })).rejects.toMatchObject({ code: "look_not_eligible" });
  });

  it("audio mode drops HeyGen voice_settings and motion_prompt for avatar_iv twin", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue({ ...makeEligibleLook(), supportedApiEngines: ["avatar_iv"] }),
      createAvatarVVideo: jest.fn().mockResolvedValue({ videoId: "vid-s", status: "pending" }),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    const r = await svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId, assetToken: makeValidToken(), idempotencyKey,
      settings: { fit: "cover", voice_settings: { speed: 1.3 }, motion_prompt: "wave" },
    });
    expect(r.engine).toBe("avatar_iv");
    expect(r.appliedSettings).toEqual({ fit: "cover" });
    expect(fakeHeygen.createAvatarVVideo).toHaveBeenCalledWith(expect.objectContaining({ settings: { fit: "cover" } }));
  });

  it("passes a valid aspectRatio through to HeyGen and returns it; defaults to 9:16", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLook()),
      createAvatarVVideo: jest.fn().mockResolvedValue({ videoId: "vid-ar", status: "pending" }),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    const r1 = await svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId, assetToken: makeValidToken(), idempotencyKey, aspectRatio: "16:9",
    });
    expect(r1.aspectRatio).toBe("16:9");
    expect(fakeHeygen.createAvatarVVideo).toHaveBeenLastCalledWith(expect.objectContaining({ aspectRatio: "16:9" }));
    const r2 = await svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId, assetToken: makeValidToken(), idempotencyKey,
    });
    expect(r2.aspectRatio).toBe("9:16");
  });

  it("rejects an aspectRatio outside the HeyGen allowlist before any HeyGen call", async () => {
    const fakeHeygen = { getLook: jest.fn(), createAvatarVVideo: jest.fn() };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    await expect(svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId, assetToken: makeValidToken(), idempotencyKey, aspectRatio: "21:9",
    })).rejects.toMatchObject({ code: "invalid_key" });
    expect(fakeHeygen.getLook).not.toHaveBeenCalled();
    expect(fakeHeygen.createAvatarVVideo).not.toHaveBeenCalled();
  });

  it("returns videoId, jobToken, lookId, and estCostUsd; calls createAvatarVVideo with engine avatar_v; never calls s3.send", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLook()),
      createAvatarVVideo: jest.fn().mockResolvedValue({ videoId: "vid-123", status: "pending" }),
    };
    const fakeS3 = { send: jest.fn() };
    const svc = makeService({
      heygen: () => fakeHeygen as unknown as HeyGenClient,
      s3: fakeS3 as unknown as import("@aws-sdk/client-s3").S3Client,
    });
    const result = await svc.createVideo("u1", {
      draftId: "d1", audioAssetId, lookId,
      assetToken: makeValidToken(), idempotencyKey,
    });
    expect(result.heygenVideoId).toBe("vid-123");
    expect(result.jobToken).toHaveLength(64);
    expect(result.lookId).toBe(lookId);
    expect(typeof result.estCostUsd).toBe("number");
    expect(fakeS3.send).not.toHaveBeenCalled();
    // createAvatarVVideo called with avatarId=lookId and Idempotency-Key; engine set server-side
    expect(fakeHeygen.createAvatarVVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarId: lookId,
        audioAssetId,
        idempotencyKey,
        aspectRatio: "9:16",
        resolution: "1080p",
      })
    );
  });
});

// ---------------------------------------------------------------------------
// getVideoStatus

describe("AdLabAvatarService.getVideoStatus", () => {
  function makeServiceWithHeygen(heygenStatus: Awaited<ReturnType<HeyGenClient["getVideo"]>>) {
    const fakeHeygen = {
      getVideo: jest.fn().mockResolvedValue(heygenStatus),
    };
    return makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
  }

  // Generate a valid token for u1/d1/vid-1
  function validToken(_svc: AdLabAvatarService): string {
    return createHmac("sha256", "test-secret-for-avatar-service")
      .update("u1|d1|vid-1")
      .digest("hex");
  }

  it("throws invalid_token for a wrong token", async () => {
    const svc = makeServiceWithHeygen({ status: "pending" });
    await expect(svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token: "bad-token" }))
      .rejects.toMatchObject({ code: "invalid_token" });
  });

  it("returns queued for waiting status", async () => {
    const svc = makeServiceWithHeygen({ status: "waiting" });
    const token = validToken(svc);
    const result = await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token });
    expect(result.status).toBe("queued");
  });

  it("returns queued for pending status", async () => {
    const svc = makeServiceWithHeygen({ status: "pending" });
    const token = validToken(svc);
    const result = await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token });
    expect(result.status).toBe("queued");
  });

  it("returns processing for processing status", async () => {
    const svc = makeServiceWithHeygen({ status: "processing" });
    const token = validToken(svc);
    const result = await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token });
    expect(result.status).toBe("processing");
  });

  it("returns failed with error for failed status", async () => {
    const svc = makeServiceWithHeygen({ status: "failed", failureMessage: "HeyGen crashed" });
    const token = validToken(svc);
    const result = await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("HeyGen crashed");
  });

  it("copies video and returns ready on completed status", async () => {
    const fakeUploadStream = jest.fn(async () => ({ sizeBytes: 5000 }));
    const fakeFetch = jest.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(ctrl) { ctrl.enqueue(new Uint8Array(10)); ctrl.close(); },
      }),
    }));
    const fakeHeygen = { getVideo: jest.fn().mockResolvedValue({ status: "completed", videoUrl: "https://heygen.cdn/vid.mp4", duration: 30 }) };

    const svc = makeService({
      heygen: () => fakeHeygen as unknown as HeyGenClient,
      uploadStream: fakeUploadStream,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    const token = validToken(svc);
    const result = await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token });

    expect(result.status).toBe("ready");
    expect(result.videoKey).toContain("ad_lab/u1/avatar/d1/video-vid-1.mp4");
    expect(fakeUploadStream).toHaveBeenCalledTimes(1);
    expect(result.durationSec).toBe(30);
  });

  it("skips copy when HeadObject succeeds (already copied)", async () => {
    const fakeUploadStream = jest.fn(async () => ({ sizeBytes: 5000 }));
    const fakeHeygen = { getVideo: jest.fn().mockResolvedValue({ status: "completed", videoUrl: "https://heygen.cdn/vid.mp4", duration: 10 }) };

    // S3 that succeeds on HeadObject (already exists)
    const fakeS3 = {
      send: jest.fn(async (cmd: object) => {
        const name = (cmd as { constructor: { name: string } }).constructor.name;
        if (name === "HeadObjectCommand") return {}; // exists
        if (name === "GetObjectCommand") return {
          Body: (async function* () { yield Buffer.from("fake-bytes"); })(),
        };
        return {};
      }),
    };

    const svc = makeService({
      heygen: () => fakeHeygen as unknown as HeyGenClient,
      uploadStream: fakeUploadStream,
      s3: fakeS3 as unknown as import("@aws-sdk/client-s3").S3Client,
    });
    const token = validToken(svc);
    await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token });

    // uploadStream should NOT be called since HeadObject said it already exists
    expect(fakeUploadStream).not.toHaveBeenCalled();
  });

  it("maps HeyGen 429 to rate_limited with retryAfterSeconds", async () => {
    const fakeHeygen = {
      getVideo: jest.fn().mockRejectedValue(new HeyGenApiError(429, "rate_limited", "rate limit", 45)),
    };
    const svc = makeService({ heygen: () => fakeHeygen as unknown as HeyGenClient });
    const token = validToken(svc);
    const err = await svc.getVideoStatus("u1", { draftId: "d1", videoId: "vid-1", token }).catch((e) => e);
    expect(err).toBeInstanceOf(AdLabAvatarError);
    expect((err as AdLabAvatarError).code).toBe("rate_limited");
    expect((err as AdLabAvatarError).retryAfterSeconds).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// generateVoice — speed / tone settings

describe("AdLabAvatarService.generateVoice speed/tone", () => {
  it("stored voice contains speedId and toneId", async () => {
    const svc = makeService();
    const result = await svc.generateVoice("real-user", {
      draftId: "d1",
      voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
      speedId: "fast",
      toneId: "energetic",
    });
    expect(result.voice.speedId).toBe("fast");
    expect(result.voice.speed).toBe(1.1);
    expect(result.voice.toneId).toBe("energetic");
  });

  it("defaults to slow/casual when speedId/toneId are omitted", async () => {
    const svc = makeService();
    const result = await svc.generateVoice("real-user", {
      draftId: "d1",
      voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
    });
    expect(result.voice.speedId).toBe(DEFAULT_VOICE_SPEED_ID);
    expect(result.voice.toneId).toBe(DEFAULT_VOICE_TONE_ID);
  });

  it("synthesize receives speed and tone settings in voiceSettings", async () => {
    const fakeSynthesize = jest.fn(async () => Buffer.from("mp3"));
    const svc = makeService({ synthesize: fakeSynthesize });
    await svc.generateVoice("real-user", {
      draftId: "d1",
      voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
      speedId: "normal",
      toneId: "professional",
    });
    expect(fakeSynthesize).toHaveBeenCalledTimes(1);
    const callArg = (fakeSynthesize.mock.calls as unknown as Array<[{ voiceSettings: Record<string, unknown> }]>)[0]![0];
    expect(callArg.voiceSettings.speed).toBe(1.0);
    expect(callArg.voiceSettings.stability).toBe(1.0);
    expect(callArg.voiceSettings.use_speaker_boost).toBe(true);
  });

  it("synthesize WITHOUT voiceSettings uses only stability from config (old behaviour)", async () => {
    // synthesizeSpeech itself: if called without voiceSettings it should use { stability } from config.
    // This test verifies the service always passes voiceSettings (never leaves it absent).
    const fakeSynthesize = jest.fn(async () => Buffer.from("mp3"));
    const svc = makeService({ synthesize: fakeSynthesize });
    await svc.generateVoice("real-user", {
      draftId: "d1",
      voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
      // No speedId/toneId → defaults applied
    });
    const callArg2 = (fakeSynthesize.mock.calls as unknown as Array<[{ voiceSettings?: Record<string, unknown> }]>)[0]![0];
    // Service always sends voiceSettings; never leaves it undefined
    expect(callArg2.voiceSettings).toBeDefined();
  });

  it("voice cost is per-character and does NOT change with speed", async () => {
    const fakeSynthesize = jest.fn(async () => Buffer.from("mp3"));
    const svcSlow = makeService({ synthesize: fakeSynthesize });
    const svcFast = makeService({ synthesize: fakeSynthesize });

    const resultSlow = await svcSlow.generateVoice("real-user", {
      draftId: "d1",
      voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
      speedId: "very_slow",
    });
    const resultFast = await svcFast.generateVoice("real-user", {
      draftId: "d1",
      voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
      speedId: "very_fast",
    });

    // Same chars → same cost regardless of speed
    expect(resultSlow.voice.chars).toBe(resultFast.voice.chars);
    expect(resultSlow.voice.estCostUsd).toBeCloseTo(resultFast.voice.estCostUsd, 8);
  });

  it("throws too_long when slow speed pushes adjusted duration over maxSec", async () => {
    // A script that is borderline: at speed=1.0 it would be ~175 s (< 180 s cap),
    // but at very_slow (0.75) it becomes ~233 s > 180 s.
    const chars = Math.ceil(175 * 13); // 13 chars/sec × 175 s = 2275 chars; at 0.75 → ~233 s
    const borderlineDraft: AdLabScriptDraft = {
      ...DRAFT_APPROVED,
      scriptPlan: "ก".repeat(chars),
    };
    const svc = makeService({ loadDraftResult: borderlineDraft });
    await expect(
      svc.generateVoice("real-user", {
        draftId: "d1",
        voiceId: DEFAULT_AD_LAB_AVATAR_VOICE_ID,
        speedId: "very_slow",
      })
    ).rejects.toMatchObject({ code: "too_long" });
  });
});

// ---------------------------------------------------------------------------
// getConfig — speed/tone lists

describe("AdLabAvatarService.getConfig speed/tone", () => {
  it("returns 5 speed options with the default speed id", () => {
    const cfg = makeService().getConfig();
    expect(cfg.speeds).toHaveLength(5);
    expect(cfg.defaultSpeedId).toBe(DEFAULT_VOICE_SPEED_ID);
  });

  it("returns 4 tone options with the default tone id", () => {
    const cfg = makeService().getConfig();
    expect(cfg.tones).toHaveLength(4);
    expect(cfg.defaultToneId).toBe(DEFAULT_VOICE_TONE_ID);
  });

  it("speed objects have id, label, speed fields", () => {
    const cfg = makeService().getConfig();
    for (const s of cfg.speeds) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.speed).toBe("number");
    }
  });

  it("tone objects have id and label fields", () => {
    const cfg = makeService().getConfig();
    for (const t of cfg.tones) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.label).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Twin creation — initiateTwinUpload

describe("AdLabAvatarService.initiateTwinUpload", () => {
  function makeHeyGen(overrides: Partial<InstanceType<typeof HeyGenClient>> = {}) {
    return jest.fn(() => ({
      initiateDirectUpload: jest.fn(async () => ({
        assetId: "asset-dt-1",
        uploadUrl: "https://s3.example.com/upload",
        uploadHeaders: { "Content-Type": "video/mp4" },
        expiresInSeconds: 3600,
        maxBytes: 209715200,
      })),
      ...overrides,
    })) as unknown as () => HeyGenClient;
  }

  it("returns assetId, uploadUrl, uploadHeaders for valid mp4", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    const result = await svc.initiateTwinUpload("real-user", {
      fileName: "twin.mp4",
      contentType: "video/mp4",
      sizeBytes: 1024 * 1024,
      durationSec: 60,
    });
    expect(result.assetId).toBe("asset-dt-1");
    expect(result.uploadUrl).toBe("https://s3.example.com/upload");
    expect(result.uploadHeaders["Content-Type"]).toBe("video/mp4");
  });

  it("accepts video/webm", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "twin.webm",
        contentType: "video/webm",
        sizeBytes: 1024,
        durationSec: 30,
      })
    ).resolves.toBeDefined();
  });

  it("throws twin_type_invalid for unsupported content type", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "twin.avi",
        contentType: "video/avi",
        sizeBytes: 1024,
      })
    ).rejects.toMatchObject({ code: "twin_type_invalid" });
  });

  it("throws twin_too_large when sizeBytes > 200MB", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "big.mp4",
        contentType: "video/mp4",
        sizeBytes: 209_715_201,
      })
    ).rejects.toMatchObject({ code: "twin_too_large" });
  });

  it("throws twin_too_large when sizeBytes is 0", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "empty.mp4",
        contentType: "video/mp4",
        sizeBytes: 0,
      })
    ).rejects.toMatchObject({ code: "twin_too_large" });
  });

  it("throws twin_duration_invalid when durationSec < 15", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "short.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
        durationSec: 5,
      })
    ).rejects.toMatchObject({ code: "twin_duration_invalid" });
  });

  it("throws twin_duration_invalid when durationSec > 600", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "long.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
        durationSec: 601,
      })
    ).rejects.toMatchObject({ code: "twin_duration_invalid" });
  });

  it("throws local_account for dev local user", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.initiateTwinUpload("studio-local-owner", {
        fileName: "t.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
      })
    ).rejects.toMatchObject({ code: "local_account" });
  });

  it("throws heygen_not_configured when HEYGEN_API_KEY absent", async () => {
    const svc = makeService(); // heygen factory throws HeyGenNotConfiguredError by default
    await expect(
      svc.initiateTwinUpload("real-user", {
        fileName: "t.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
      })
    ).rejects.toMatchObject({ code: "heygen_not_configured" });
  });
});

// ---------------------------------------------------------------------------
// Twin creation — completeTwinUpload

describe("AdLabAvatarService.completeTwinUpload", () => {
  it("resolves when HeyGen completes successfully", async () => {
    const completeFn = jest.fn(async () => undefined);
    const svc = makeService({
      heygen: jest.fn(() => ({ completeDirectUpload: completeFn })) as unknown as () => HeyGenClient,
    });
    await expect(svc.completeTwinUpload("real-user", { assetId: "asset-abc" })).resolves.toBeUndefined();
    expect(completeFn).toHaveBeenCalledWith("asset-abc");
  });

  it("throws invalid_key for malformed assetId", async () => {
    const svc = makeService({
      heygen: jest.fn(() => ({ completeDirectUpload: jest.fn() })) as unknown as () => HeyGenClient,
    });
    await expect(
      svc.completeTwinUpload("real-user", { assetId: "bad id with spaces!" })
    ).rejects.toMatchObject({ code: "invalid_key" });
  });
});

// ---------------------------------------------------------------------------
// Twin creation — createTwin

describe("AdLabAvatarService.createTwin", () => {
  function makeHeyGen() {
    return jest.fn(() => ({
      createDigitalTwin: jest.fn(async () => ({
        lookId: "look-dt-1",
        groupId: "group-dt-1",
        defaultVoiceId: "voice-1",
      })),
    })) as unknown as () => HeyGenClient;
  }

  it("returns lookId, groupId, defaultVoiceId", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    const result = await svc.createTwin("real-user", {
      name: "My Twin",
      assetId: "asset-dt-1",
      idempotencyKey: "idem-key-12345678",
    });
    expect(result.lookId).toBe("look-dt-1");
    expect(result.groupId).toBe("group-dt-1");
    expect(result.defaultVoiceId).toBe("voice-1");
  });

  it("throws invalid_key when name is empty", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.createTwin("real-user", { name: "  ", assetId: "asset-1", idempotencyKey: "key-12345678" })
    ).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("throws invalid_key for bad idempotencyKey", async () => {
    const svc = makeService({ heygen: makeHeyGen() });
    await expect(
      svc.createTwin("real-user", { name: "Twin", assetId: "asset-1", idempotencyKey: "bad" })
    ).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("passes Idempotency-Key to createDigitalTwin", async () => {
    const createFn = jest.fn(async () => ({ lookId: "l", groupId: "g" }));
    const svc = makeService({
      heygen: jest.fn(() => ({ createDigitalTwin: createFn })) as unknown as () => HeyGenClient,
    });
    await svc.createTwin("real-user", {
      name: "T",
      assetId: "a.1",
      idempotencyKey: "idem-12345678",
    });
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "idem-12345678" })
    );
  });
});

// ---------------------------------------------------------------------------
// Twin creation — requestTwinConsentUrl

describe("AdLabAvatarService.requestTwinConsentUrl", () => {
  it("returns url and consentStatus from HeyGen", async () => {
    const svc = makeService({
      heygen: jest.fn(() => ({
        requestTwinConsent: jest.fn(async () => ({
          url: "https://heygen.com/consent/abc",
          consentStatus: "pending",
        })),
      })) as unknown as () => HeyGenClient,
    });
    const result = await svc.requestTwinConsentUrl("real-user", { groupId: "group-dt-1" });
    expect(result.url).toBe("https://heygen.com/consent/abc");
    expect(result.consentStatus).toBe("pending");
  });

  it("throws twin_consent_conflict when HeyGen returns 400", async () => {
    const svc = makeService({
      heygen: jest.fn(() => ({
        requestTwinConsent: jest.fn(async () => {
          throw new HeyGenApiError(400, "consent_accepted", "already accepted");
        }),
      })) as unknown as () => HeyGenClient,
    });
    await expect(
      svc.requestTwinConsentUrl("real-user", { groupId: "group-dt-1" })
    ).rejects.toMatchObject({ code: "twin_consent_conflict" });
  });

  it("throws invalid_key for malformed groupId", async () => {
    const svc = makeService({
      heygen: jest.fn(() => ({ requestTwinConsent: jest.fn() })) as unknown as () => HeyGenClient,
    });
    await expect(
      svc.requestTwinConsentUrl("real-user", { groupId: "" })
    ).rejects.toMatchObject({ code: "invalid_key" });
  });
});

// ---------------------------------------------------------------------------
// Twin creation — getTwinStatus

describe("AdLabAvatarService.getTwinStatus", () => {
  function makeLookHeyGen(lookOverrides: Partial<{ id: string; status: string; supportedApiEngines: string[] }> = {}) {
    return jest.fn(() => ({
      getLook: jest.fn(async () => ({
        id: lookOverrides.id ?? "look-1",
        name: "Twin",
        avatarType: "digital_twin",
        supportedApiEngines: lookOverrides.supportedApiEngines ?? ["avatar_v"],
        status: lookOverrides.status ?? "completed",
      })),
      getAvatarGroup: jest.fn(async () => ({ consentStatus: "accepted" })),
    })) as unknown as () => HeyGenClient;
  }

  it("returns lookStatus=completed, avatarV=true, consentStatus=accepted", async () => {
    const svc = makeService({ heygen: makeLookHeyGen() });
    const result = await svc.getTwinStatus("real-user", {
      lookId: "look-1",
      groupId: "group-1",
    });
    expect(result.lookStatus).toBe("completed");
    expect(result.avatarV).toBe(true);
    expect(result.consentStatus).toBe("accepted");
    expect(result.error).toBeUndefined();
  });

  it("returns avatarV=false when avatar_v engine is not supported", async () => {
    const svc = makeService({
      heygen: makeLookHeyGen({ supportedApiEngines: ["avatar_iv"] }),
    });
    const result = await svc.getTwinStatus("real-user", { lookId: "look-1" });
    expect(result.avatarV).toBe(false);
  });

  it("returns error message when consent is rejected", async () => {
    const svc = makeService({
      heygen: jest.fn(() => ({
        getLook: jest.fn(async () => ({
          id: "look-1", name: "T", avatarType: "digital_twin",
          supportedApiEngines: ["avatar_v"], status: "processing",
        })),
        getAvatarGroup: jest.fn(async () => ({
          consentStatus: "rejected",
          error: { message: "Face not detected" },
        })),
      })) as unknown as () => HeyGenClient,
    });
    const result = await svc.getTwinStatus("real-user", { lookId: "look-1", groupId: "group-1" });
    expect(result.consentStatus).toBe("rejected");
    expect(result.error).toContain("Face not detected");
  });

  it("throws invalid_key for invalid lookId", async () => {
    const svc = makeService({ heygen: makeLookHeyGen() });
    await expect(
      svc.getTwinStatus("real-user", { lookId: "has spaces!" })
    ).rejects.toMatchObject({ code: "invalid_key" });
  });
});

// ---------------------------------------------------------------------------
// getLooks

describe("AdLabAvatarService.getLooks", () => {
  function makeListLooksHeygen(
    pages: Array<{ looks: HeyGenLook[]; hasMore: boolean; nextToken?: string }>
  ) {
    let callCount = 0;
    return jest.fn(() => ({
      listLooks: jest.fn(async () => {
        const page = pages[callCount] ?? { looks: [], hasMore: false };
        callCount++;
        return page;
      }),
    })) as unknown as () => HeyGenClient;
  }

  function makeLook(overrides: Partial<HeyGenLook> = {}): HeyGenLook {
    return {
      id: "lk-1",
      name: "My Twin",
      avatarType: "digital_twin",
      supportedApiEngines: ["avatar_v"],
      status: "completed",
      ...overrides,
    };
  }

  afterEach(() => {
    delete process.env.HEYGEN_API_KEY;
    delete process.env.RCLIPPER_AD_LAB_HEYGEN_LOOK_ID;
  });

  it("returns configured:false and empty looks when HEYGEN_API_KEY is absent", async () => {
    delete process.env.HEYGEN_API_KEY;
    const svc = makeService();
    const result = await svc.getLooks();
    expect(result.configured).toBe(false);
    expect(result.looks).toHaveLength(0);
  });

  it("returns all digital_twin looks (including non-selectable) with selectable flag", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    const svc = makeService({
      heygen: makeListLooksHeygen([{
        looks: [
          makeLook({ id: "lk-eligible", status: "completed" }),
          makeLook({ id: "lk-processing", status: "processing" }),
          makeLook({ id: "lk-no-engine", supportedApiEngines: ["avatar_iii"] }),
        ],
        hasMore: false,
      }]),
    });
    const result = await svc.getLooks();
    expect(result.configured).toBe(true);
    expect(result.looks).toHaveLength(3);
    expect(result.looks.find((l) => l.id === "lk-eligible")?.selectable).toBe(true);
    expect(result.looks.find((l) => l.id === "lk-processing")?.selectable).toBe(false);
    expect(result.looks.find((l) => l.id === "lk-no-engine")?.selectable).toBe(false);
  });

  it("selectable when completed (or no status) and avatar_v or avatar_iv is supported, any avatar type", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    const svc = makeService({
      heygen: makeListLooksHeygen([{
        looks: [
          makeLook({ id: "ok-completed", status: "completed" }),
          makeLook({ id: "ok-no-status", status: undefined }),
          makeLook({ id: "photo-v", avatarType: "photo_avatar", status: "completed" }),
          makeLook({ id: "iv-only", supportedApiEngines: ["avatar_iv"], status: "completed" }),
          makeLook({ id: "bad-engine", supportedApiEngines: [], status: "completed" }),
          makeLook({ id: "bad-status", status: "processing" }),
        ],
        hasMore: false,
      }]),
    });
    const result = await svc.getLooks();
    const byId = Object.fromEntries(result.looks.map((l) => [l.id, l.selectable]));
    expect(byId["ok-completed"]).toBe(true);
    expect(byId["ok-no-status"]).toBe(true);
    expect(byId["photo-v"]).toBe(true);
    expect(byId["iv-only"]).toBe(true);
    const engines = Object.fromEntries(result.looks.map((l) => [l.id, l.engine]));
    expect(engines["ok-completed"]).toBe("avatar_v");
    expect(engines["iv-only"]).toBe("avatar_iv");
    expect(engines["bad-engine"]).toBeNull();
    expect(byId["bad-engine"]).toBe(false);
    expect(byId["bad-status"]).toBe(false);
  });

  it("lists private looks of every avatar type (no avatar_type filter)", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    const listLooks = jest.fn(async () => ({ looks: [makeLook({ id: "023511475ea24e6e95fb810c1af90bad", name: "Motion Look" })], hasMore: false }));
    const svc = makeService({ heygen: () => ({ listLooks }) as unknown as HeyGenClient });
    const result = await svc.getLooks();
    expect(listLooks).toHaveBeenCalledWith(expect.objectContaining({ ownership: "private" }));
    expect((listLooks.mock.calls[0] as unknown as [Record<string, unknown>])[0].avatarType).toBeUndefined();
    expect(result.looks[0]).toMatchObject({ name: "Motion Look", selectable: true, engine: "avatar_v" });
  });

  it("paginates and stops at LOOKS_MAX_PAGES (5)", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    // 6 pages of 1 look each with hasMore=true — should only read 5
    const pages = Array.from({ length: 6 }, (_, i) => ({
      looks: [makeLook({ id: `lk-${i}` })],
      hasMore: true,
      nextToken: `token-${i + 1}`,
    }));
    const svc = makeService({ heygen: makeListLooksHeygen(pages) });
    const result = await svc.getLooks();
    expect(result.configured).toBe(true);
    expect(result.looks).toHaveLength(5);
  });

  it("returns defaultLookId when RCLIPPER_AD_LAB_HEYGEN_LOOK_ID is set", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    process.env.RCLIPPER_AD_LAB_HEYGEN_LOOK_ID = "lk-default";
    const svc = makeService({
      heygen: makeListLooksHeygen([{ looks: [], hasMore: false }]),
    });
    const result = await svc.getLooks();
    expect(result.defaultLookId).toBe("lk-default");
  });

  it("returns configured:false without crashing when HeyGen factory throws HeyGenNotConfiguredError", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    const svc = makeService({
      heygen: () => { throw new HeyGenNotConfiguredError(); },
    });
    const result = await svc.getLooks();
    expect(result.configured).toBe(false);
    expect(result.looks).toHaveLength(0);
  });

  it("maps defaultVoiceId from look into each look entry", async () => {
    process.env.HEYGEN_API_KEY = "fake-key";
    const fakeHeygen = {
      listLooks: jest.fn().mockResolvedValue({
        looks: [
          { id: "lk-1", name: "Twin A", avatarType: "digital_twin", supportedApiEngines: ["avatar_v"], status: "completed", defaultVoiceId: "vx-111" },
          { id: "lk-2", name: "Photo", avatarType: "photo_avatar", supportedApiEngines: ["avatar_v"], status: "completed" },
        ],
        hasMore: false,
      }),
    };
    const svc = makeService({ heygen: jest.fn(() => fakeHeygen) as unknown as () => HeyGenClient });
    const result = await svc.getLooks();
    expect(result.looks[0]?.defaultVoiceId).toBe("vx-111");
    expect(result.looks[1]?.defaultVoiceId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createTtsVideo

describe("AdLabAvatarService.createTtsVideo", () => {
  const idempotencyKey = "idem-tts-12345678";
  const lookId = "lk-tts-test-1";

  function makeEligibleLookWithVoice(voiceId = "heygen-voice-abc"): HeyGenLook {
    return {
      id: lookId,
      name: "TTS Twin",
      avatarType: "digital_twin",
      supportedApiEngines: ["avatar_v"],
      status: "completed",
      defaultVoiceId: voiceId,
    };
  }

  function makeHeygenForTts(look: HeyGenLook | null) {
    return jest.fn(() => ({
      getLook: jest.fn().mockResolvedValue(look),
      createTtsVideo: jest.fn().mockResolvedValue({ videoId: "tts-vid-123", status: "pending" }),
    })) as unknown as () => HeyGenClient;
  }

  it("validates settings, keeps applicable ones for twin + avatar_v TTS, and returns appliedSettings", async () => {
    const createTtsVideo = jest.fn().mockResolvedValue({ videoId: "tts-s", status: "pending" });
    const getLook = jest.fn().mockResolvedValue(makeEligibleLookWithVoice());
    const svc = makeService({ heygen: () => ({ getLook, createTtsVideo }) as unknown as HeyGenClient });
    const r = await svc.createTtsVideo("u1", {
      draftId: "d1", lookId, script: "สวัสดีครับ", idempotencyKey, kind: "test",
      settings: {
        resolution: "720p", fit: "contain", background: { type: "color", value: "#112233" },
        motion_prompt: "nod", expressiveness: "high", voice_settings: { speed: 1.2, pitch: 0, volume: 1 },
        caption: { file_format: "srt", style: "default" }, title: "t1",
      },
    });
    const expected = {
      resolution: "720p", fit: "contain", background: { type: "color", value: "#112233" },
      motion_prompt: "nod", voice_settings: { speed: 1.2 },
      caption: { file_format: "srt", style: "default" }, title: "t1",
    };
    expect(r.appliedSettings).toEqual(expected);
    expect(createTtsVideo).toHaveBeenCalledWith(expect.objectContaining({ settings: expected }));
  });

  it("rejects invalid settings (bad hex, out of range, unknown key) before any HeyGen call", async () => {
    const createTtsVideo = jest.fn();
    const getLook = jest.fn();
    const svc = makeService({ heygen: () => ({ getLook, createTtsVideo }) as unknown as HeyGenClient });
    for (const settings of [
      { background: { type: "color", value: "red" } },
      { voice_settings: { speed: 2 } },
      { voice_settings: { pitch: 1.5 } },
      { resolution: "4k" },
      { avatar_scale: 1.2 },
    ]) {
      await expect(
        svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "abc", idempotencyKey, kind: "test", settings })
      ).rejects.toMatchObject({ code: "invalid_key" });
    }
    expect(getLook).not.toHaveBeenCalled();
    expect(createTtsVideo).not.toHaveBeenCalled();
  });

  it("landscape twin in 9:16 defaults to fit cover; 16:9 sends no fit; explicit contain wins", async () => {
    const look = { ...makeEligibleLookWithVoice(), imageWidth: 1920, imageHeight: 1080, preferredOrientation: "landscape" as const };
    const createTtsVideo = jest.fn().mockResolvedValue({ videoId: "tts-fit", status: "pending" });
    const svc = makeService({ heygen: () => ({ getLook: jest.fn().mockResolvedValue(look), createTtsVideo }) as unknown as HeyGenClient });
    const base = { draftId: "d1", lookId, script: "abc", idempotencyKey, kind: "test" as const };
    const r916 = await svc.createTtsVideo("u1", { ...base, aspectRatio: "9:16" });
    expect(r916.appliedSettings).toEqual({ fit: "cover" });
    expect(createTtsVideo).toHaveBeenLastCalledWith(expect.objectContaining({ settings: { fit: "cover" }, aspectRatio: "9:16" }));
    const r169 = await svc.createTtsVideo("u1", { ...base, aspectRatio: "16:9" });
    expect(r169.appliedSettings).toEqual({});
    const rContain = await svc.createTtsVideo("u1", { ...base, aspectRatio: "9:16", settings: { fit: "contain" } });
    expect(rContain.appliedSettings).toEqual({ fit: "contain" });
  });

  it("passes aspectRatio to HeyGen TTS video and rejects unsupported values", async () => {
    const createTtsVideo = jest.fn().mockResolvedValue({ videoId: "tts-ar", status: "pending" });
    const getLook = jest.fn().mockResolvedValue(makeEligibleLookWithVoice());
    const svc = makeService({ heygen: () => ({ getLook, createTtsVideo }) as unknown as HeyGenClient });
    const r = await svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35\u0E04\u0E23\u0E31\u0E1A", idempotencyKey, kind: "test", aspectRatio: "1:1" });
    expect(r.aspectRatio).toBe("1:1");
    expect(createTtsVideo).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "1:1" }));
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "abc", idempotencyKey, kind: "test", aspectRatio: "3:2" })
    ).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("throws local_account for dev user", async () => {
    const svc = makeService({ heygen: makeHeygenForTts(makeEligibleLookWithVoice()) });
    await expect(
      svc.createTtsVideo("studio-local-owner", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "test" })
    ).rejects.toMatchObject({ code: "local_account" });
  });

  it("throws not_found for blank script", async () => {
    const svc = makeService({ heygen: makeHeygenForTts(makeEligibleLookWithVoice()) });
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "   ", idempotencyKey, kind: "test" })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("throws too_long when script exceeds char limit", async () => {
    const svc = makeService({ heygen: makeHeygenForTts(makeEligibleLookWithVoice()) });
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "ก".repeat(5001), idempotencyKey, kind: "test" })
    ).rejects.toMatchObject({ code: "too_long" });
  });

  it("throws heygen_not_configured when no HeyGen key", async () => {
    const svc = makeService(); // default heygen throws HeyGenNotConfiguredError
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "test" })
    ).rejects.toMatchObject({ code: "heygen_not_configured" });
  });

  it("throws look_not_found when getLook returns null", async () => {
    const svc = makeService({ heygen: makeHeygenForTts(null) });
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "test" })
    ).rejects.toMatchObject({ code: "look_not_found" });
  });

  it("throws tts_voice_missing when look has no defaultVoiceId", async () => {
    const lookNoVoice = { ...makeEligibleLookWithVoice(), defaultVoiceId: undefined } as HeyGenLook;
    const svc = makeService({ heygen: makeHeygenForTts(lookNoVoice) });
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "test" })
    ).rejects.toMatchObject({ code: "tts_voice_missing" });
  });

  it("resolves defaultVoiceId from look server-side (not from client) and passes it to createTtsVideo", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLookWithVoice("look-voice-xyz")),
      createTtsVideo: jest.fn().mockResolvedValue({ videoId: "tts-vid-999", status: "pending" }),
    };
    const svc = makeService({ heygen: jest.fn(() => fakeHeygen) as unknown as () => HeyGenClient });
    const result = await svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดีครับ", idempotencyKey, kind: "test" });

    expect(result.defaultVoiceId).toBe("look-voice-xyz");
    expect(fakeHeygen.createTtsVideo).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: "look-voice-xyz", script: "สวัสดีครับ" })
    );
  });

  it("returns heygenVideoId, jobToken (64-hex), engine, estCostUsd, lookId", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLookWithVoice()),
      createTtsVideo: jest.fn().mockResolvedValue({ videoId: "tts-vid-42", status: "pending" }),
    };
    const svc = makeService({ heygen: jest.fn(() => fakeHeygen) as unknown as () => HeyGenClient });
    const result = await svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "test" });

    expect(result.heygenVideoId).toBe("tts-vid-42");
    expect(result.jobToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.engine).toBe("avatar_v");
    expect(typeof result.estCostUsd).toBe("number");
    expect(result.lookId).toBe(lookId);
  });

  it("production mode: throws not_found when draft does not exist", async () => {
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLookWithVoice()),
      createTtsVideo: jest.fn().mockResolvedValue({ videoId: "v1", status: "pending" }),
    };
    const svc = makeService({ heygen: jest.fn(() => fakeHeygen) as unknown as () => HeyGenClient, loadDraftResult: null });
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "production" })
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("test mode: skips draft validation entirely (loadDraft not called)", async () => {
    const mockLoadDraft = jest.fn(async () => null);
    const fakeHeygen = {
      getLook: jest.fn().mockResolvedValue(makeEligibleLookWithVoice()),
      createTtsVideo: jest.fn().mockResolvedValue({ videoId: "v1", status: "pending" }),
    };
    const svc = new AdLabAvatarService({
      loadDraft: mockLoadDraft,
      synthesize: jest.fn(async () => Buffer.from("mp3")),
      heygen: jest.fn(() => fakeHeygen) as unknown as () => HeyGenClient,
      s3: makeFakeS3() as unknown as import("@aws-sdk/client-s3").S3Client,
      bucket: "test-bucket",
      signUrl: jest.fn(async () => "https://signed.url/test"),
      uploadStream: jest.fn(async () => ({ sizeBytes: 1000 })),
      fetchImpl: jest.fn(() => { throw new Error("no fetch"); }) as unknown as typeof fetch,
      now: () => new Date("2026-10-12T00:00:00.000Z"),
      tokenSecret: () => "test-secret-for-avatar-service",
      elevenLabsConfigured: () => true,
    });
    await expect(
      svc.createTtsVideo("u1", { draftId: "d1", lookId, script: "สวัสดี", idempotencyKey, kind: "test" })
    ).resolves.toBeDefined();
    expect(mockLoadDraft).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteVideoFile

describe("AdLabAvatarService.deleteVideoFile", () => {
  function makeServiceForDelete(mockSend?: jest.Mock) {
    const s3 = { send: mockSend ?? jest.fn(async () => ({})) };
    return {
      svc: makeService({ s3: s3 as unknown as import("@aws-sdk/client-s3").S3Client }),
      send: s3.send,
    };
  }

  it("throws local_account for dev user", async () => {
    const { svc } = makeServiceForDelete();
    const videoKey = "ad_lab/studio-local-owner/avatar/d1/video-v1.mp4";
    await expect(svc.deleteVideoFile("studio-local-owner", { draftId: "d1", videoKey }))
      .rejects.toMatchObject({ code: "local_account" });
  });

  it("throws invalid_key when videoKey belongs to a different user", async () => {
    const { svc } = makeServiceForDelete();
    await expect(svc.deleteVideoFile("u1", { draftId: "d1", videoKey: "ad_lab/u2/avatar/d1/video-v1.mp4" }))
      .rejects.toMatchObject({ code: "invalid_key" });
  });

  it("throws invalid_key when videoKey has wrong draftId", async () => {
    const { svc } = makeServiceForDelete();
    await expect(svc.deleteVideoFile("u1", { draftId: "d1", videoKey: "ad_lab/u1/avatar/d99/video-v1.mp4" }))
      .rejects.toMatchObject({ code: "invalid_key" });
  });

  it("throws invalid_key when key is under a completely different prefix", async () => {
    const { svc } = makeServiceForDelete();
    await expect(svc.deleteVideoFile("u1", { draftId: "d1", videoKey: "other/u1/avatar/d1/video.mp4" }))
      .rejects.toMatchObject({ code: "invalid_key" });
  });

  it("calls DeleteObjectCommand with the exact videoKey for a valid own-prefix key", async () => {
    const mockSend = jest.fn(async () => ({}));
    const { svc } = makeServiceForDelete(mockSend);
    const videoKey = "ad_lab/u1/avatar/d1/video-abc123.mp4";
    await svc.deleteVideoFile("u1", { draftId: "d1", videoKey });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = (mockSend.mock.calls[0] as unknown as [{ constructor: { name: string }; input: { Key: string; Bucket: string } }])[0];
    expect(cmd.constructor.name).toBe("DeleteObjectCommand");
    expect(cmd.input.Key).toBe(videoKey);
    expect(cmd.input.Bucket).toBe("test-bucket");
  });
});
