import { HeyGenClient } from "@/lib/ai/heygenClient";
import { AdLabAvatarService, AdLabAvatarError } from "@/services/ad-lab/AdLabAvatarService";
import { withDefaultFit } from "@/config/heygenVideoOptions";

beforeAll(() => {
  global.fetch = jest.fn(() => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
});

describe("HeyGenClient.createDigitalTwin avatar_group_id", () => {
  function mk() {
    const f = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: { avatar_item: { id: "look-new", group_id: "grp1" }, avatar_group: { id: "grp1" } } }),
      text: async () => "",
    });
    return { f, c: new HeyGenClient({ apiKey: "k", baseUrl: "https://api.heygen.com", fetchImpl: f as unknown as typeof fetch }) };
  }
  it("sends avatar_group_id when given, plus Idempotency-Key", async () => {
    const { f, c } = mk();
    await c.createDigitalTwin({ name: "P", assetId: "a1", idempotencyKey: "idem-12345678", avatarGroupId: "grp1" }).catch(() => undefined);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.heygen.com/v3/avatars");
    expect(JSON.parse(init.body as string)).toEqual({ type: "digital_twin", name: "P", file: { type: "asset_id", asset_id: "a1" }, avatar_group_id: "grp1" });
    expect(JSON.stringify(init.headers)).toContain("idem-12345678");
  });
  it("omits avatar_group_id for a brand-new twin", async () => {
    const { f, c } = mk();
    await c.createDigitalTwin({ name: "P", assetId: "a1", idempotencyKey: "idem-12345678" }).catch(() => undefined);
    expect(JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)).not.toHaveProperty("avatar_group_id");
  });
});

describe("AdLabAvatarService.createTwin for a new look in an existing group", () => {
  function mk() {
    const createDigitalTwin = jest.fn(async () => ({ lookId: "look-p", groupId: "f7cef2fb561a42a18ebc81a8dffd28cc" }));
    const svc = new AdLabAvatarService({
      loadDraft: jest.fn(async () => null),
      synthesize: jest.fn(),
      heygen: () => ({ createDigitalTwin }) as unknown as HeyGenClient,
      s3: {} as never, bucket: "b", signUrl: jest.fn(), uploadStream: jest.fn(),
      fetchImpl: jest.fn(() => { throw new Error("network disabled"); }) as unknown as typeof fetch,
      now: () => new Date("2026-10-13T00:00:00Z"),
      tokenSecret: () => "s", elevenLabsConfigured: () => true,
    } as never);
    return { svc, createDigitalTwin };
  }
  const base = { name: "Portrait", assetId: "asset-1", idempotencyKey: "idem-key-12345678" };

  it("passes avatarGroupId through", async () => {
    const { svc, createDigitalTwin } = mk();
    await svc.createTwin("u1", { ...base, avatarGroupId: "f7cef2fb561a42a18ebc81a8dffd28cc", clientDurationSec: 120, clientWidth: 1080, clientHeight: 1920 });
    expect(createDigitalTwin).toHaveBeenCalledWith(expect.objectContaining({ avatarGroupId: "f7cef2fb561a42a18ebc81a8dffd28cc", idempotencyKey: base.idempotencyKey }));
  });
  it.each([
    [{ avatarGroupId: "bad id!" }],
    [{ clientDurationSec: 10 }],
    [{ clientDurationSec: 601 }],
    [{ clientWidth: 1920, clientHeight: 1080 }],
    [{ clientWidth: 1080, clientHeight: 1080 }],
  ])("rejects %j before any HeyGen call", async (extra) => {
    const { svc, createDigitalTwin } = mk();
    await expect(svc.createTwin("u1", { ...base, ...extra })).rejects.toBeInstanceOf(AdLabAvatarError);
    expect(createDigitalTwin).not.toHaveBeenCalled();
  });
});

describe("default-fit stays compatible with portrait looks", () => {
  it("portrait look at 9:16 sends no fit; landscape look at 9:16 gets cover", () => {
    expect(withDefaultFit({}, "9:16", { width: 1080, height: 1920 }).fit).toBeUndefined();
    expect(withDefaultFit({}, "9:16", { width: 1280, height: 720 }).fit).toBe("cover");
    expect(withDefaultFit({}, "16:9", { width: 1080, height: 1920 }).fit).toBe("cover");
  });
});