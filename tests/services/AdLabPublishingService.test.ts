/**
 * AdLabPublishingService — the Ad Lab's real publish path and results read-back.
 *
 * Pins: ownership and connection state are validated before anything is
 * written; one provider post goes to every destination; a provider failure
 * fails the targets and is never retried; refresh maps per-destination
 * outcomes and normalises metrics; the local dev login can never publish.
 * Every dependency is injected — no database, storage or network.
 */

jest.mock("@/lib/spaces", () => ({
  spacesClient: {},
  SPACES_BUCKET: "test-bucket",
  spacesSignedUrl: jest.fn(),
}));

import { AdLabPublishingError, AdLabPublishingService } from "@/services/ad-lab/AdLabPublishingService";
import { MockAdLabPublicationRepository } from "@/repositories/mock/MockAdLabPublicationRepository";
import { SocialPublishingError } from "@/services/social-publishing/errors";
import { SocialConnectionStatus } from "@/domain/enums/ManagementStatus";
import type { SocialConnection } from "@/domain/models/SocialConnection";
import type { SocialPublishingProvider } from "@/services/social-publishing/provider";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const VIDEO = `ad_lab/${OWNER}/abc-video.mp4`;

function connection(over: Partial<SocialConnection>): SocialConnection {
  const now = new Date();
  return {
    id: "c1", userId: OWNER, provider: "post_for_me", providerAccountId: "sa_1", providerProjectId: null,
    platform: "tiktok", accountName: "Shop", accountUsername: "@shop", avatarUrl: null,
    connectionStatus: SocialConnectionStatus.Connected, providerMetadata: null, connectStateHash: null,
    connectStateExpiresAt: null, connectedAt: now, lastSyncedAt: now, disconnectedAt: null,
    createdAt: now, updatedAt: now, ...over,
  };
}

function setup(opts: { headFails?: boolean; createFails?: boolean } = {}) {
  const connections = new Map<string, SocialConnection>([
    ["c1", connection({ id: "c1" })],
    ["c2", connection({ id: "c2", providerAccountId: "sa_2", platform: "youtube", accountUsername: "Shop TV" })],
    ["c3", connection({ id: "c3", userId: OTHER, providerAccountId: "sa_3" })],
    ["c4", connection({ id: "c4", providerAccountId: "sa_4", connectionStatus: SocialConnectionStatus.Disconnected })],
  ]);
  const connectionRepo = { findById: async (id: string) => connections.get(id) ?? null };
  const repo = new MockAdLabPublicationRepository(new Map());

  const provider = {
    key: "post_for_me",
    prepareMedia: jest.fn(async ({ sourceUrl }: { sourceUrl: string }) => ({ url: sourceUrl })),
    createPost: jest.fn(async () => {
      if (opts.createFails) throw new SocialPublishingError("timeout", "Provider timed out");
      return { externalPostId: "sp_1", status: "processing" as const };
    }),
    getPostStatus: jest.fn(async () => ({
      externalPostId: "sp_1",
      status: "processed" as const,
      results: [
        { externalResultId: "r1", externalPostId: "sp_1", externalAccountId: "sa_1", success: true, publishedUrl: "https://tiktok.com/v/1", platformPostId: "tt1", error: null },
        { externalResultId: "r2", externalPostId: "sp_1", externalAccountId: "sa_2", success: false, publishedUrl: null, platformPostId: null, error: { code: "x", message: "Video too short" } },
      ],
    })),
    getPostInsights: jest.fn(async () => [
      { externalAccountId: "sa_1", platform: "tiktok", platformPostId: "tt1", platformUrl: null, externalPostId: "sp_1", postedAt: null, metrics: { view_count: 900, like_count: 45, comment_count: 4, share_count: 1 } },
    ]),
  } as unknown as SocialPublishingProvider & { createPost: jest.Mock; getPostInsights: jest.Mock };

  const s3 = {
    send: jest.fn(async () => {
      if (opts.headFails) throw new Error("NotFound");
      return {};
    }),
  };
  const service = new AdLabPublishingService(
    repo,
    connectionRepo as never,
    provider,
    s3 as never,
    async (key) => `https://signed.example/${key}`
  );
  return { service, repo, provider, s3 };
}

const baseInput = {
  brandId: "b1",
  draftId: "d1",
  campaignName: "Pad Thai launch",
  title: "Pad Thai launch",
  caption: "New menu!",
  videoKey: VIDEO,
  videoName: "video.mp4",
  targets: [
    { channel: "tiktok" as const, connectionId: "c1", plannedBudget: 300 },
    { channel: "youtube" as const, connectionId: "c2" },
  ],
};

describe("AdLabPublishingService.publish", () => {
  it("sends ONE post to every destination and records it before sending", async () => {
    const { service, provider, repo } = setup();
    const publication = await service.publish(OWNER, baseInput);

    expect(provider.createPost).toHaveBeenCalledTimes(1);
    const sent = provider.createPost.mock.calls[0][0];
    expect(sent.targets.map((t: { externalAccountId: string }) => t.externalAccountId)).toEqual(["sa_1", "sa_2"]);
    expect(sent.externalId).toBe(`adlab_${publication.id}`);
    expect(sent.media[0].url).toBe(`https://signed.example/${VIDEO}`);
    // YouTube needs a title; other platforms take the caption only.
    expect(sent.targets[1].title).toBe("Pad Thai launch");
    expect(sent.targets[0].title).toBeUndefined();

    expect(publication.providerPostId).toBe("sp_1");
    expect(publication.status).toBe("processing");
    expect(publication.targets[0].plannedBudget).toBe(300);
    expect((await repo.listByOwner(OWNER)).length).toBe(1);
  });

  it("refuses the dev-only local login", async () => {
    const { service, provider } = setup();
    await expect(service.publish("studio-local-owner", baseInput)).rejects.toMatchObject({ code: "local_account" });
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it("refuses another user's connection, a disconnected one, and a channel mismatch — writing nothing", async () => {
    const { service, repo, provider } = setup();
    await expect(service.publish(OWNER, { ...baseInput, targets: [{ channel: "tiktok", connectionId: "c3" }] }))
      .rejects.toMatchObject({ code: "unknown_connection" });
    await expect(service.publish(OWNER, { ...baseInput, targets: [{ channel: "tiktok", connectionId: "c4" }] }))
      .rejects.toMatchObject({ code: "connection_not_connected" });
    await expect(service.publish(OWNER, { ...baseInput, targets: [{ channel: "instagram", connectionId: "c1" }] }))
      .rejects.toMatchObject({ code: "channel_mismatch" });
    await expect(service.publish(OWNER, { ...baseInput, targets: [baseInput.targets[0], baseInput.targets[0]] }))
      .rejects.toMatchObject({ code: "duplicate_target" });
    expect(await repo.listByOwner(OWNER)).toHaveLength(0);
    expect(provider.createPost).not.toHaveBeenCalled();
  });

  it("refuses a video that is not under the owner's prefix or not uploaded", async () => {
    const { service } = setup();
    await expect(service.publish(OWNER, { ...baseInput, videoKey: `ad_lab/${OTHER}/x.mp4` }))
      .rejects.toMatchObject({ code: "video_not_found" });
    const missing = setup({ headFails: true });
    await expect(missing.service.publish(OWNER, baseInput)).rejects.toMatchObject({ code: "video_not_found" });
  });

  it("marks every target failed on a provider error and does not retry", async () => {
    const { service, provider, repo } = setup({ createFails: true });
    await expect(service.publish(OWNER, baseInput)).rejects.toBeInstanceOf(AdLabPublishingError);
    expect(provider.createPost).toHaveBeenCalledTimes(1);
    const [publication] = await repo.listByOwner(OWNER);
    expect(publication.status).toBe("failed");
    expect(publication.targets.every((t) => t.status === "failed")).toBe(true);
  });
});

describe("AdLabPublishingService.refresh", () => {
  it("maps per-destination outcomes and stores normalised metrics", async () => {
    const { service, repo } = setup();
    const { id } = await service.publish(OWNER, baseInput);
    const { publication, warnings } = await service.refresh(OWNER, id);

    const [tiktok, youtube] = publication.targets;
    expect(tiktok.status).toBe("published");
    expect(tiktok.platformUrl).toBe("https://tiktok.com/v/1");
    expect(tiktok.metrics).toMatchObject({ views: 900, likes: 45, comments: 4, shares: 1 });
    expect(youtube.status).toBe("failed");
    expect(youtube.error).toBe("Video too short");
    expect(publication.status).toBe("partially_failed");
    expect(repo.snapshots).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("asks to reconnect when the account has no analytics permission", async () => {
    const { service, provider } = setup();
    const { id } = await service.publish(OWNER, baseInput);
    provider.getPostInsights.mockRejectedValueOnce(new SocialPublishingError("permission_denied", "feeds_not_granted"));
    const { warnings } = await service.refresh(OWNER, id);
    expect(warnings.some((w) => w.includes("เชื่อมต่อบัญชีใหม่"))).toBe(true);
  });

  it("hides another owner's publication", async () => {
    const { service } = setup();
    const { id } = await service.publish(OWNER, baseInput);
    await expect(service.refresh(OTHER, id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("AdLabPublishingService.updateEconomics", () => {
  it("saves spend / revenue / conversions for the owner only, clamping bad values", async () => {
    const { service } = setup();
    const publication = await service.publish(OWNER, baseInput);
    const targetId = publication.targets[0].id;

    const updated = await service.updateEconomics(OWNER, targetId, { spend: 250, revenue: -5, conversions: 2.6 });
    expect(updated.targets[0]).toMatchObject({ spend: 250, revenue: 0, conversions: 3 });
    await expect(service.updateEconomics(OTHER, targetId, { spend: 1 })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("AdLabPublishingService.beginVideoUpload", () => {
  it("validates type and size before issuing any upload URL", async () => {
    const { service } = setup();
    await expect(service.beginVideoUpload({ userId: OWNER, fileName: "a.gif", fileSizeBytes: 10, mimeType: "image/gif" }))
      .rejects.toMatchObject({ code: "unsupported_type" });
    await expect(service.beginVideoUpload({ userId: OWNER, fileName: "a.mp4", fileSizeBytes: 0, mimeType: "video/mp4" }))
      .rejects.toMatchObject({ code: "empty_file" });
    await expect(service.beginVideoUpload({ userId: OWNER, fileName: "a.mp4", fileSizeBytes: 10 ** 12, mimeType: "video/mp4" }))
      .rejects.toMatchObject({ code: "too_large" });
  });
});
