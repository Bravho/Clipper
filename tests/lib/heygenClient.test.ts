import { HeyGenApiError, HeyGenClient, HeyGenNotConfiguredError, isHeyGenConfigured } from "@/lib/ai/heygenClient";

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isHeyGenConfigured

describe("isHeyGenConfigured", () => {
  const ORIG = process.env.HEYGEN_API_KEY;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = ORIG;
  });

  it("returns false when HEYGEN_API_KEY is absent", () => {
    delete process.env.HEYGEN_API_KEY;
    expect(isHeyGenConfigured()).toBe(false);
  });

  it("returns true when HEYGEN_API_KEY is set", () => {
    process.env.HEYGEN_API_KEY = "test-key";
    expect(isHeyGenConfigured()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constructor

describe("HeyGenClient constructor", () => {
  it("throws HeyGenNotConfiguredError when no key given and env absent", () => {
    const ORIG = process.env.HEYGEN_API_KEY;
    delete process.env.HEYGEN_API_KEY;
    expect(() => new HeyGenClient({ fetchImpl: jest.fn() })).toThrow(HeyGenNotConfiguredError);
    if (ORIG !== undefined) process.env.HEYGEN_API_KEY = ORIG;
  });

  it("constructs successfully with an explicit apiKey", () => {
    expect(() => new HeyGenClient({ apiKey: "k", fetchImpl: jest.fn() })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// uploadAsset

describe("HeyGenClient.uploadAsset", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "test-key", baseUrl: "https://api.heygen.com", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("sends multipart POST to /v3/assets with X-Api-Key header", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "asset-abc" } }),
    });
    const client = makeClient(mockFetch);

    const result = await client.uploadAsset({ bytes: Buffer.from("audio"), fileName: "voice.mp3", contentType: "audio/mpeg" });

    expect(result).toEqual({ assetId: "asset-abc" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heygen.com/v3/assets");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
  });

  it("also accepts data.asset_id", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { asset_id: "asset-xyz" } }),
    });
    const result = await makeClient(mockFetch).uploadAsset({
      bytes: Buffer.from("img"),
      fileName: "photo.jpg",
      contentType: "image/jpeg",
    });
    expect(result.assetId).toBe("asset-xyz");
  });

  it("throws HeyGenApiError on non-ok response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });
    await expect(makeClient(mockFetch).uploadAsset({ bytes: Buffer.alloc(0), fileName: "f", contentType: "audio/mpeg" }))
      .rejects.toBeInstanceOf(HeyGenApiError);
  });

  it("maps 429 to HeyGenApiError with retryAfterSeconds", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (h: string) => (h === "Retry-After" ? "30" : null) },
      text: async () => "rate limited",
    });
    const err = await makeClient(mockFetch).uploadAsset({ bytes: Buffer.alloc(0), fileName: "f", contentType: "audio/mpeg" }).catch((e) => e);
    expect(err).toBeInstanceOf(HeyGenApiError);
    expect((err as HeyGenApiError).status).toBe(429);
    expect((err as HeyGenApiError).retryAfterSeconds).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// listLooks

describe("HeyGenClient.listLooks", () => {
  it("parses the documented v3 shape (data array + top-level has_more/next_token)", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{
            id: "023511475ea24e6e95fb810c1af90bad",
            name: "Motion Look",
            avatar_type: "digital_twin",
            group_id: "f7cef2fb561a42a18ebc81a8dffd28cc",
            status: "completed",
            supported_api_engines: ["avatar_v", "avatar_iv", "avatar_iii"],
          }],
          has_more: true,
          next_token: "tok-next",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const result = await makeClient(mockFetch).listLooks({ ownership: "private", limit: 50 });
    expect(result.looks).toHaveLength(1);
    expect(result.looks[0]).toMatchObject({
      name: "Motion Look",
      avatarType: "digital_twin",
      groupId: "f7cef2fb561a42a18ebc81a8dffd28cc",
      supportedApiEngines: ["avatar_v", "avatar_iv", "avatar_iii"],
    });
    expect(result.hasMore).toBe(true);
    expect(result.nextToken).toBe("tok-next");
  });

  it("createAvatarVVideo sends the server-chosen engine", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { video_id: "v1", status: "waiting" } }), { status: 200 })
    );
    await makeClient(mockFetch).createAvatarVVideo({
      avatarId: "lk", audioAssetId: "a1", idempotencyKey: "key-12345678",
      aspectRatio: "9:16", resolution: "1080p", engine: "avatar_iv",
    });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.engine).toEqual({ type: "avatar_iv" });
    expect(body.audio_asset_id).toBe("a1");
  });

  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("sends GET /v3/avatars/looks with X-Api-Key and query params", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          looks: [
            {
              id: "look-1",
              name: "Twin A",
              avatar_type: "digital_twin",
              supported_api_engines: ["avatar_v"],
              status: "completed",
              preview_image_url: "https://cdn/img.jpg",
            },
          ],
          has_more: false,
        },
      }),
    });
    const client = makeClient(mockFetch);
    const result = await client.listLooks({ avatarType: "digital_twin", ownership: "private", limit: 50 });

    expect(result.looks).toHaveLength(1);
    expect(result.looks[0]!.id).toBe("look-1");
    expect(result.looks[0]!.avatarType).toBe("digital_twin");
    expect(result.looks[0]!.supportedApiEngines).toContain("avatar_v");
    expect(result.hasMore).toBe(false);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v3/avatars/looks");
    expect(url).toContain("avatar_type=digital_twin");
    expect(url).toContain("ownership=private");
    expect(url).toContain("limit=50");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });

  it("returns hasMore=true and nextToken when has_more is set", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { looks: [], has_more: true, next_token: "tok-abc" },
      }),
    });
    const result = await makeClient(mockFetch).listLooks({});
    expect(result.hasMore).toBe(true);
    expect(result.nextToken).toBe("tok-abc");
  });

  it("returns empty looks on empty data", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });
    const result = await makeClient(mockFetch).listLooks({});
    expect(result.looks).toEqual([]);
    expect(result.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getLook

describe("HeyGenClient.getLook", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("returns the look when API responds with 200", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: "lk-1",
          name: "My Twin",
          avatar_type: "digital_twin",
          supported_api_engines: ["avatar_v"],
          status: "completed",
          preview_image_url: "https://cdn/img.jpg",
        },
      }),
    });
    const look = await makeClient(mockFetch).getLook("lk-1");
    expect(look).not.toBeNull();
    expect(look!.id).toBe("lk-1");
    expect(look!.avatarType).toBe("digital_twin");
    expect(look!.supportedApiEngines).toContain("avatar_v");
    expect(look!.status).toBe("completed");
    expect(look!.previewImageUrl).toBe("https://cdn/img.jpg");
  });

  it("returns null when API returns 404", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    });
    const look = await makeClient(mockFetch).getLook("missing");
    expect(look).toBeNull();
  });

  it("throws HeyGenApiError for non-404 errors", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    await expect(makeClient(mockFetch).getLook("lk-1")).rejects.toBeInstanceOf(HeyGenApiError);
  });
});

// ---------------------------------------------------------------------------
// createAvatarVVideo

describe("HeyGenClient.createAvatarVVideo", () => {
  it("sends POST /v3/videos with engine avatar_v, avatar_id, 9:16, 1080p, audio asset, and Idempotency-Key header", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { video_id: "vid-v1", status: "pending" } }),
    });
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });

    const result = await client.createAvatarVVideo({
      avatarId: "lk-twin-1",
      audioAssetId: "aud-asset-1",
      idempotencyKey: "idem-key-avatar-v",
      aspectRatio: "9:16",
      resolution: "1080p",
    });

    expect(result).toEqual({ videoId: "vid-v1", status: "pending" });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heygen.com/v3/videos");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("idem-key-avatar-v");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");

    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("avatar");
    expect(body.avatar_id).toBe("lk-twin-1");
    expect(body.engine).toEqual({ type: "avatar_v" });
    expect(body.audio_asset_id).toBe("aud-asset-1");
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.resolution).toBe("1080p");

    // Must NOT contain image fields
    expect(body.image).toBeUndefined();
    expect(body.fit).toBeUndefined();
    // Must NOT contain motion_prompt or expressiveness
    expect(body.motion_prompt).toBeUndefined();
    expect(body.expressiveness).toBeUndefined();
  });

  it("engine is always avatar_v even when client does not pass one", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { video_id: "v2", status: "pending" } }),
    });
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    await client.createAvatarVVideo({
      avatarId: "lk-1",
      audioAssetId: "aud-1",
      idempotencyKey: "key-12345678",
      aspectRatio: "9:16",
      resolution: "1080p",
    });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.engine).toEqual({ type: "avatar_v" });
  });
});

// ---------------------------------------------------------------------------
// getVideo

describe("HeyGenClient.getVideo", () => {
  it("returns mapped fields from the response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          status: "completed",
          video_url: "https://cdn.heygen.com/video.mp4",
          thumbnail_url: "https://cdn.heygen.com/thumb.jpg",
          duration: 45.5,
        },
      }),
    });
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    const result = await client.getVideo("vid-abc");

    expect(result.status).toBe("completed");
    expect(result.videoUrl).toBe("https://cdn.heygen.com/video.mp4");
    expect(result.duration).toBe(45.5);
  });

  it("maps 429 with retryAfterSeconds from Retry-After header", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (h: string) => (h === "Retry-After" ? "60" : null) },
      text: async () => "too many requests",
    });
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    const err = await client.getVideo("vid-1").catch((e) => e);
    expect(err).toBeInstanceOf(HeyGenApiError);
    expect((err as HeyGenApiError).retryAfterSeconds).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// initiateDirectUpload

describe("HeyGenClient.initiateDirectUpload", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("sends POST /v3/assets/direct-uploads with correct body and X-Api-Key", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          asset_id: "asset-dt-1",
          upload_url: "https://s3.example.com/upload",
          upload_headers: { "Content-Type": "video/mp4", "Content-Length": "1024" },
          expires_in_seconds: 3600,
          max_bytes: 209715200,
        },
      }),
    });
    const client = makeClient(mockFetch);
    const result = await client.initiateDirectUpload({
      fileName: "twin.mp4",
      contentType: "video/mp4",
      sizeBytes: 1024,
    });

    expect(result.assetId).toBe("asset-dt-1");
    expect(result.uploadUrl).toBe("https://s3.example.com/upload");
    expect(result.uploadHeaders).toEqual({ "Content-Type": "video/mp4", "Content-Length": "1024" });
    expect(result.expiresInSeconds).toBe(3600);
    expect(result.maxBytes).toBe(209715200);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heygen.com/v3/assets/direct-uploads");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    const body = JSON.parse(init.body as string);
    expect(body.filename).toBe("twin.mp4");
    expect(body.content_type).toBe("video/mp4");
    expect(body.size_bytes).toBe(1024);
  });

  it("throws HeyGenApiError when asset_id or upload_url missing", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { asset_id: "x" } }), // missing upload_url
    });
    await expect(makeClient(mockFetch).initiateDirectUpload({
      fileName: "f.mp4", contentType: "video/mp4", sizeBytes: 100,
    })).rejects.toBeInstanceOf(HeyGenApiError);
  });

  it("throws HeyGenApiError on non-ok response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => "bad request",
    });
    await expect(makeClient(mockFetch).initiateDirectUpload({
      fileName: "f.mp4", contentType: "video/mp4", sizeBytes: 100,
    })).rejects.toBeInstanceOf(HeyGenApiError);
  });
});

// ---------------------------------------------------------------------------
// completeDirectUpload

describe("HeyGenClient.completeDirectUpload", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("sends POST /v3/assets/{assetId}/complete", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" });
    const client = makeClient(mockFetch);
    await expect(client.completeDirectUpload("asset-abc")).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v3/assets/asset-abc/complete");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });

  it("treats 404 as success (idempotent)", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" });
    await expect(makeClient(mockFetch).completeDirectUpload("asset-abc")).resolves.toBeUndefined();
  });

  it("throws HeyGenApiError for non-404 errors", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => "server error",
    });
    await expect(makeClient(mockFetch).completeDirectUpload("asset-abc")).rejects.toBeInstanceOf(HeyGenApiError);
  });
});

// ---------------------------------------------------------------------------
// createDigitalTwin

describe("HeyGenClient.createDigitalTwin", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("sends POST /v3/avatars with type=digital_twin, file.asset_id, and Idempotency-Key header", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          avatar_item: { id: "look-dt-1", default_voice_id: "voice-1" },
          avatar_group: { id: "group-dt-1" },
        },
      }),
    });
    const client = makeClient(mockFetch);
    const result = await client.createDigitalTwin({
      name: "My Twin",
      assetId: "asset-dt-1",
      idempotencyKey: "idem-key-12345678",
    });

    expect(result.lookId).toBe("look-dt-1");
    expect(result.groupId).toBe("group-dt-1");
    expect(result.defaultVoiceId).toBe("voice-1");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heygen.com/v3/avatars");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("idem-key-12345678");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("digital_twin");
    expect(body.name).toBe("My Twin");
    expect(body.file).toEqual({ type: "asset_id", asset_id: "asset-dt-1" });
  });

  it("throws HeyGenApiError when avatar_item.id or avatar_group.id missing", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { avatar_item: { id: "look-1" } } }), // missing avatar_group
    });
    await expect(makeClient(mockFetch).createDigitalTwin({
      name: "T", assetId: "a", idempotencyKey: "key-12345678",
    })).rejects.toBeInstanceOf(HeyGenApiError);
  });
});

// ---------------------------------------------------------------------------
// requestTwinConsent

describe("HeyGenClient.requestTwinConsent", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("sends POST /v3/avatars/{groupId}/consent and returns url + consentStatus", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          avatar_group: { id: "group-1", consent_status: "pending" },
          url: "https://heygen.com/consent/abc123",
        },
      }),
    });
    const client = makeClient(mockFetch);
    const result = await client.requestTwinConsent("group-1");

    expect(result.url).toBe("https://heygen.com/consent/abc123");
    expect(result.consentStatus).toBe("pending");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v3/avatars/group-1/consent");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });

  it("throws HeyGenApiError when url is missing from response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { avatar_group: { consent_status: "pending" } } }),
    });
    await expect(makeClient(mockFetch).requestTwinConsent("group-1")).rejects.toBeInstanceOf(HeyGenApiError);
  });

  it("throws HeyGenApiError on 400 (consent already accepted)", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => "consent already accepted",
    });
    await expect(makeClient(mockFetch).requestTwinConsent("group-1")).rejects.toBeInstanceOf(HeyGenApiError);
  });
});

// ---------------------------------------------------------------------------
// getAvatarGroup

describe("HeyGenClient.getAvatarGroup", () => {
  function makeClient(fetchImpl: jest.Mock) {
    return new HeyGenClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
  }

  it("returns consentStatus from the response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { consent_status: "accepted" } }),
    });
    const client = makeClient(mockFetch);
    const result = await client.getAvatarGroup("group-1");
    expect(result.consentStatus).toBe("accepted");
    expect(result.error).toBeUndefined();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v3/avatars/group-1");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });

  it("includes error.message when present in response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          consent_status: "rejected",
          error: { code: "moderation_failed", message: "Content violates policy" },
        },
      }),
    });
    const result = await makeClient(mockFetch).getAvatarGroup("group-1");
    expect(result.consentStatus).toBe("rejected");
    expect(result.error?.message).toBe("Content violates policy");
  });

  it("defaults consentStatus to pending when absent", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: {} }),
    });
    const result = await makeClient(mockFetch).getAvatarGroup("group-1");
    expect(result.consentStatus).toBe("pending");
  });

  it("throws HeyGenApiError on non-ok response", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => "forbidden",
    });
    await expect(makeClient(mockFetch).getAvatarGroup("group-1")).rejects.toBeInstanceOf(HeyGenApiError);
  });
});

describe("HeyGenClient.createTtsVideo exact body shape (v3)", () => {
  it("sends top-level script + voice_id with avatar_id/engine, and no audio or input_text fields", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { video_id: "v-tts", status: "waiting" } }), { status: 200 })
    );
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    await client.createTtsVideo({
      avatarId: "023511475ea24e6e95fb810c1af90bad",
      voiceId: "9e77c949fc90426e8cfa332b3e2ea103",
      script: "\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35\u0E04\u0E23\u0E31\u0E1A",
      idempotencyKey: "idem-tts-12345678",
      aspectRatio: "9:16",
      resolution: "1080p",
      engine: "avatar_v",
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe("https://api.heygen.com/v3/videos");
    expect(init.headers["Idempotency-Key"]).toBe("idem-tts-12345678");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      type: "avatar",
      avatar_id: "023511475ea24e6e95fb810c1af90bad",
      engine: { type: "avatar_v" },
      script: "\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35\u0E04\u0E23\u0E31\u0E1A",
      voice_id: "9e77c949fc90426e8cfa332b3e2ea103",
      aspect_ratio: "9:16",
      resolution: "1080p",
    });
  });

  it("audio mode sends audio_asset_id and no script/voice_id", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { video_id: "v-a", status: "waiting" } }), { status: 200 })
    );
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    await client.createAvatarVVideo({
      avatarId: "lk", audioAssetId: "asset-1", idempotencyKey: "idem-a-12345678",
      aspectRatio: "9:16", resolution: "1080p", engine: "avatar_v",
    });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.audio_asset_id).toBe("asset-1");
    expect(body).not.toHaveProperty("script");
    expect(body).not.toHaveProperty("voice_id");
    expect(body).not.toHaveProperty("input_text");
  });

  it("logs only body keys (no values) when HeyGen rejects the request", async () => {
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "invalid_parameter", message: "bad" } }), { status: 400 })
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const client = new HeyGenClient({ apiKey: "secret-key", fetchImpl: mockFetch as unknown as typeof fetch });
    await expect(client.createTtsVideo({
      avatarId: "lk", voiceId: "vv", script: "hello-script", idempotencyKey: "idem-x-12345678",
      aspectRatio: "9:16", resolution: "1080p",
    })).rejects.toBeDefined();
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("script");
    expect(logged).toContain("voice_id");
    expect(logged).not.toContain("hello-script");
    expect(logged).not.toContain("secret-key");
    warn.mockRestore();
  });
});
describe("HeyGenClient advanced settings body mapping", () => {
  it("maps settings to snake_case body fields and overrides resolution/title", async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ data: { video_id: "v", status: "waiting" } }), { status: 200 }));
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    await client.createTtsVideo({
      avatarId: "lk", voiceId: "vv", script: "s", idempotencyKey: "idem-m-12345678", aspectRatio: "16:9", resolution: "1080p",
      settings: {
        resolution: "720p", fit: "contain", background: { type: "color", value: "#000000" }, remove_background: true,
        motion_prompt: "nod", voice_settings: { pitch: 5 }, caption: { file_format: "srt", style: "default" }, title: "T",
      },
    });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body).toMatchObject({
      script: "s", voice_id: "vv", aspect_ratio: "16:9", resolution: "720p", fit: "contain",
      background: { type: "color", value: "#000000" }, remove_background: true, motion_prompt: "nod",
      voice_settings: { pitch: 5 }, caption: { file_format: "srt", style: "default" }, title: "T",
    });
  });
});

describe("HeyGenClient look frame mapping", () => {
  it("maps image_width/image_height/preferred_orientation from GET look", async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      id: "023511475ea24e6e95fb810c1af90bad", name: "Motion Look", avatar_type: "digital_twin",
      supported_api_engines: ["avatar_v"], status: "completed",
      image_width: 1920, image_height: 1080, preferred_orientation: "landscape",
    } }), { status: 200 }));
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    const look = await client.getLook("023511475ea24e6e95fb810c1af90bad");
    expect(look).toMatchObject({ imageWidth: 1920, imageHeight: 1080, preferredOrientation: "landscape" });
  });

  it("sends fit cover in the body when settings carry it", async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ data: { video_id: "v", status: "waiting" } }), { status: 200 }));
    const client = new HeyGenClient({ apiKey: "k", fetchImpl: mockFetch as unknown as typeof fetch });
    await client.createTtsVideo({ avatarId: "lk", voiceId: "vv", script: "s", idempotencyKey: "idem-f-12345678", aspectRatio: "9:16", resolution: "1080p", settings: { fit: "cover" } });
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.fit).toBe("cover");
    expect(body.aspect_ratio).toBe("9:16");
  });
});
