/**
 * ManagementPublicationService — the publish path.
 *
 * These tests pin the load-bearing behaviour described in the service header:
 *   * the paid gate refuses (and creates nothing) when payment is required;
 *   * ownership, connection state and video shape are validated before any
 *     record is written;
 *   * destinations that use DIFFERENT video variants become SEPARATE provider
 *     posts, while destinations sharing a variant are one post;
 *   * a failed provider group fails only its own targets;
 *   * the rolled-up status and the mirrored content status follow the targets.
 *
 * Every dependency is injected, so nothing here needs a database or the network.
 * `@/lib/spaces` is mocked so importing the service never constructs an S3
 * client (the signed-URL functions are injected as fakes anyway).
 */

jest.mock("@/lib/spaces", () => ({
  spacesSignedUrl: jest.fn(),
  spacesPublicUrl: jest.fn(),
  SIGNED_URL_TTL_SECONDS: 3600,
}));

import {
  ManagementPublicationService,
  PublishNotEntitledError,
  PublicationValidationError,
  type CreatePublicationRequest,
} from "@/services/management/ManagementPublicationService";
import { SocialPublishingError } from "@/services/social-publishing/errors";
import {
  ManagementContentStatus,
  ManagementEntitlementType,
  ManagementJobKind,
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
  ManagementPublishMode,
  SocialConnectionStatus,
} from "@/domain/enums/ManagementStatus";

const USER = { id: "user-1", email: "a@example.com", role: "requester" };
const CONTENT_ID = "content-1";

const future = (ms: number) => new Date(Date.now() + ms);

function contentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTENT_ID,
    userId: USER.id,
    sourceType: "rclipper_generation",
    sourceGenerationId: "req-1",
    title: "Clip",
    description: null,
    thumbnailStorageKey: "thumbs/x.jpg",
    status: ManagementContentStatus.Ready,
    mediaExpiresAt: future(86_400_000),
    mediaDeletedAt: null,
    transferredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function asset(id: string, aspectRatio: string, key: string) {
  return {
    id,
    managementContentId: CONTENT_ID,
    sourceVideoId: "u1",
    platformVariant: aspectRatio,
    storageKey: key,
    mimeType: "video/mp4",
    width: null,
    height: null,
    durationSeconds: 30,
    aspectRatio,
    originalFilename: null,
    fileSizeBytes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function connection(id: string, platform: string, accountId: string, overrides = {}) {
  return {
    id,
    userId: USER.id,
    provider: "post_for_me",
    providerAccountId: accountId,
    providerProjectId: null,
    platform,
    accountName: platform,
    accountUsername: platform,
    avatarUrl: null,
    connectionStatus: SocialConnectionStatus.Connected,
    providerMetadata: null,
    connectStateHash: null,
    connectStateExpiresAt: null,
    connectedAt: new Date(),
    lastSyncedAt: null,
    disconnectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Stateful fake of the publication repo: enough to model create→update→rollup. */
class FakePublications {
  publication: Record<string, unknown> | null = null;
  targets: Record<string, unknown>[] = [];
  createWithTargets = jest.fn(async (input: Record<string, unknown>) => {
    this.publication = {
      id: "pub-1",
      userId: input.userId,
      managementContentId: input.managementContentId,
      publishMode: input.publishMode,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
      status: ManagementPublicationStatus.Draft,
      providerPostId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.targets = (input.targets as Record<string, unknown>[]).map((t, i) => ({
      id: `target-${i}`,
      publicationId: "pub-1",
      ...t,
      providerPostId: null,
      providerResultId: null,
      status: ManagementPublicationTargetStatus.Draft,
      errorCode: null,
      errorMessage: null,
      publishedUrl: null,
      publishedAt: null,
      providerMetadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    return { publication: this.publication, targets: this.targets };
  });
  setProviderPostId = jest.fn(async (_id: string, pid: string) => {
    if (this.publication && !this.publication.providerPostId) {
      this.publication.providerPostId = pid;
    }
  });
  updateTarget = jest.fn(async (id: string, fields: Record<string, unknown>) => {
    const t = this.targets.find((x) => x.id === id)!;
    Object.assign(t, fields);
    return { ...t };
  });
  updateStatus = jest.fn(async (_id: string, status: string) => {
    this.publication!.status = status;
    return { ...this.publication };
  });
  setTargetUploadBundle = jest.fn(async (id: string, bundleId: string) => {
    const t = this.targets.find((x) => x.id === id);
    if (t) t.uploadBundleId = bundleId;
  });
}

interface Overrides {
  item?: Record<string, unknown> | null;
  assets?: Record<string, unknown>[];
  connections?: Record<string, unknown>[];
  entitlement?: Record<string, unknown>;
  createPost?: jest.Mock;
  /** Override the bundle repo's consume result (default: succeeds). */
  consume?: jest.Mock;
}

function build(o: Overrides = {}) {
  const item = o.item === undefined ? contentItem() : o.item;
  const assets = o.assets ?? [asset("asset-916", "9:16", "vids/916.mp4")];
  const connById = new Map(
    (o.connections ?? [connection("conn-tt", "tiktok", "sa_tt")]).map((c) => [c.id, c])
  );
  // Default: token-based publishing (the entry bundle), so tokens are consumed.
  const ent =
    o.entitlement ?? {
      allowed: true,
      entitlementType: ManagementEntitlementType.SingleVideo,
      tokensRemaining: 4,
    };

  const content = {
    findById: jest.fn(async () => item),
    findAssets: jest.fn(async () => assets),
    updateStatus: jest.fn(async (_id: string, status: string) => ({ ...item, status })),
  };
  const connections = {
    findById: jest.fn(async (id: string) => connById.get(id) ?? null),
  };
  const publications = new FakePublications();
  const jobs = { enqueue: jest.fn(async () => ({ job: {}, created: true })) };
  const entitlement = { evaluateForPublish: jest.fn(async () => ent) };
  const createPost =
    o.createPost ??
    jest.fn(async () => ({ externalPostId: "post-1", status: "processing" }));
  const provider = { createPost };
  const audit = { record: jest.fn(async () => {}) };
  const signUrl = jest.fn(async (key: string) => `signed://${key}`);
  const publicUrl = jest.fn((key: string) => `public://${key}`);
  // One bundle id per token spent, in target order — length === count.
  const consume =
    o.consume ??
    jest.fn(async (_userId: string, count: number) =>
      Array.from({ length: count }, (_v, i) => `bundle-${i}`)
    );
  const bundles = { consume, countSpendableTokens: jest.fn(async () => 4) };

  const service = new ManagementPublicationService(
    content as never,
    connections as never,
    publications as never,
    jobs as never,
    entitlement as never,
    provider as never,
    audit as never,
    signUrl as never,
    publicUrl as never,
    bundles as never
  );

  return { service, content, connections, publications, jobs, entitlement, provider, audit, signUrl, publicUrl, bundles };
}

function req(overrides: Partial<CreatePublicationRequest> = {}): CreatePublicationRequest {
  return {
    managementContentId: CONTENT_ID,
    publishMode: ManagementPublishMode.PublishNow,
    scheduledAt: null,
    timezone: null,
    targets: [{ socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" }],
    ...overrides,
  };
}

describe("the paid gate", () => {
  it("refuses and creates nothing when payment is required", async () => {
    const h = build({ entitlement: { allowed: false, reason: "payment_required" } });
    await expect(h.service.create(USER, req())).rejects.toMatchObject({
      name: "PublishNotEntitledError",
      reason: "payment_required",
    });
    expect(h.publications.createWithTargets).not.toHaveBeenCalled();
    expect(h.provider.createPost).not.toHaveBeenCalled();
  });

  it("refuses a foreign content item as not_owner", async () => {
    const h = build({ item: contentItem({ userId: "someone-else" }) });
    await expect(h.service.create(USER, req())).rejects.toBeInstanceOf(
      PublishNotEntitledError
    );
    expect(h.publications.createWithTargets).not.toHaveBeenCalled();
  });

  it("refuses when the stored media has expired", async () => {
    const h = build({
      item: contentItem({ status: ManagementContentStatus.MediaExpired }),
    });
    await expect(h.service.create(USER, req())).rejects.toMatchObject({
      reason: "media_expired",
    });
  });
});

describe("request validation (before any write)", () => {
  it("rejects an empty target list", async () => {
    const h = build();
    await expect(
      h.service.create(USER, req({ targets: [] }))
    ).rejects.toMatchObject({ code: "no_targets" });
  });

  it("rejects the same account twice", async () => {
    const h = build();
    await expect(
      h.service.create(
        USER,
        req({
          targets: [
            { socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" },
            { socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" },
          ],
        })
      )
    ).rejects.toMatchObject({ code: "duplicate_target" });
  });

  it("rejects a variant that does not belong to the content", async () => {
    const h = build();
    await expect(
      h.service.create(
        USER,
        req({ targets: [{ socialConnectionId: "conn-tt", managementContentAssetId: "ghost" }] })
      )
    ).rejects.toMatchObject({ code: "unknown_asset" });
  });

  it("rejects an unknown connection", async () => {
    const h = build();
    await expect(
      h.service.create(
        USER,
        req({ targets: [{ socialConnectionId: "ghost", managementContentAssetId: "asset-916" }] })
      )
    ).rejects.toMatchObject({ code: "unknown_connection" });
  });

  it("rejects a disconnected account", async () => {
    const h = build({
      connections: [
        connection("conn-tt", "tiktok", "sa_tt", {
          connectionStatus: SocialConnectionStatus.Disconnected,
        }),
      ],
    });
    await expect(h.service.create(USER, req())).rejects.toMatchObject({
      code: "connection_not_connected",
    });
  });

  it("rejects a video whose shape does not fit the channel", async () => {
    // A 16:9 export sent to TikTok (vertical only).
    const h = build({
      assets: [asset("asset-169", "16:9", "vids/169.mp4")],
    });
    await expect(
      h.service.create(
        USER,
        req({ targets: [{ socialConnectionId: "conn-tt", managementContentAssetId: "asset-169" }] })
      )
    ).rejects.toMatchObject({ code: "aspect_ratio_mismatch" });
    expect(h.provider.createPost).not.toHaveBeenCalled();
  });

  it("rejects a scheduled publication with a past time", async () => {
    const h = build();
    await expect(
      h.service.create(
        USER,
        req({ publishMode: ManagementPublishMode.Scheduled, scheduledAt: future(-1000) })
      )
    ).rejects.toMatchObject({ code: "invalid_schedule" });
  });
});

describe("publish now", () => {
  it("sends one post, marks the target publishing, mirrors content status, enqueues reconcile", async () => {
    const h = build();
    const { publication, targets } = await h.service.create(USER, req());

    expect(h.provider.createPost).toHaveBeenCalledTimes(1);
    // Fresh signed URL, minted at send time.
    expect(h.signUrl).toHaveBeenCalledWith("vids/916.mp4");
    const postArg = h.provider.createPost.mock.calls[0][0];
    expect(postArg.media[0].url).toBe("signed://vids/916.mp4");
    expect(postArg.externalId).toBe("pub-1");
    expect(postArg.scheduledAt).toBeNull();

    expect(targets[0].status).toBe(ManagementPublicationTargetStatus.Publishing);
    expect(targets[0].providerPostId).toBe("post-1");
    expect(publication.status).toBe(ManagementPublicationStatus.Publishing);
    expect(publication.providerPostId).toBe("post-1");

    expect(h.content.updateStatus).toHaveBeenCalledWith(
      CONTENT_ID,
      ManagementContentStatus.Publishing
    );
    expect(h.jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: ManagementJobKind.ReconcilePublication,
        dedupeKey: "reconcile:pub-1",
      })
    );
  });

  it("composes the channel description and hashtags into the outbound provider caption", async () => {
    const h = build({
      assets: [asset("asset-169", "16:9", "vids/169.mp4")],
      connections: [connection("conn-yt", "youtube", "sa_yt")],
    });

    await h.service.create(
      USER,
      req({
        targets: [
          {
            socialConnectionId: "conn-yt",
            managementContentAssetId: "asset-169",
            title: "A day in Chiang Mai",
            caption: "Legacy caption",
            description: "The submitted YouTube description",
            hashtags: ["ChiangMai", "#Food"],
          },
        ],
      })
    );

    const postArg = h.provider.createPost.mock.calls[0][0];
    expect(postArg.caption).toBe(
      "The submitted YouTube description\n\n#ChiangMai #Food"
    );
    expect(postArg.targets[0]).toMatchObject({
      platform: "youtube",
      title: "A day in Chiang Mai",
      caption: "The submitted YouTube description\n\n#ChiangMai #Food",
    });
  });
});

describe("one post per video variant", () => {
  it("splits destinations that use different variants into separate posts", async () => {
    const createPost = jest
      .fn()
      .mockResolvedValueOnce({ externalPostId: "post-a", status: "processing" })
      .mockResolvedValueOnce({ externalPostId: "post-b", status: "processing" });
    const h = build({
      assets: [
        asset("asset-916", "9:16", "vids/916.mp4"),
        asset("asset-169", "16:9", "vids/169.mp4"),
      ],
      connections: [
        connection("conn-tt", "tiktok", "sa_tt"),
        connection("conn-yt", "youtube", "sa_yt"),
      ],
      createPost,
    });

    const { targets } = await h.service.create(
      USER,
      req({
        targets: [
          { socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" },
          { socialConnectionId: "conn-yt", managementContentAssetId: "asset-169" },
        ],
      })
    );

    expect(createPost).toHaveBeenCalledTimes(2);
    expect(createPost.mock.calls[0][0].media[0].url).toBe("signed://vids/916.mp4");
    expect(createPost.mock.calls[1][0].media[0].url).toBe("signed://vids/169.mp4");
    expect(targets.every((t) => t.status === ManagementPublicationTargetStatus.Publishing)).toBe(true);
    expect(targets.find((t) => t.platform === "tiktok")!.providerPostId).toBe("post-a");
    expect(targets.find((t) => t.platform === "youtube")!.providerPostId).toBe("post-b");
  });

  it("keeps destinations that share a variant in ONE post", async () => {
    const h = build({
      assets: [asset("asset-916", "9:16", "vids/916.mp4")],
      connections: [
        connection("conn-tt", "tiktok", "sa_tt"),
        connection("conn-ig", "instagram", "sa_ig"),
      ],
    });
    await h.service.create(
      USER,
      req({
        targets: [
          { socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" },
          { socialConnectionId: "conn-ig", managementContentAssetId: "asset-916" },
        ],
      })
    );
    expect(h.provider.createPost).toHaveBeenCalledTimes(1);
    expect(h.provider.createPost.mock.calls[0][0].targets).toHaveLength(2);
  });
});

describe("a failing provider group", () => {
  it("fails only its own targets and leaves the others sending", async () => {
    const createPost = jest
      .fn()
      .mockResolvedValueOnce({ externalPostId: "post-a", status: "processing" })
      .mockRejectedValueOnce(
        new SocialPublishingError("account_disconnected", "Reconnect the account.")
      );
    const h = build({
      assets: [
        asset("asset-916", "9:16", "vids/916.mp4"),
        asset("asset-169", "16:9", "vids/169.mp4"),
      ],
      connections: [
        connection("conn-tt", "tiktok", "sa_tt"),
        connection("conn-yt", "youtube", "sa_yt"),
      ],
      createPost,
    });

    const { targets } = await h.service.create(
      USER,
      req({
        targets: [
          { socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" },
          { socialConnectionId: "conn-yt", managementContentAssetId: "asset-169" },
        ],
      })
    );

    const tt = targets.find((t) => t.platform === "tiktok")!;
    const yt = targets.find((t) => t.platform === "youtube")!;
    expect(tt.status).toBe(ManagementPublicationTargetStatus.Publishing);
    expect(yt.status).toBe(ManagementPublicationTargetStatus.Failed);
    expect(yt.errorCode).toBe("account_disconnected");
  });
});

describe("token consumption (the entry bundle)", () => {
  it("spends one token per target and stamps each target's bundle", async () => {
    // One video to two channels = two targets = two tokens, even though it is a
    // single provider post (shared variant).
    const h = build({
      assets: [asset("asset-916", "9:16", "vids/916.mp4")],
      connections: [
        connection("conn-tt", "tiktok", "sa_tt"),
        connection("conn-ig", "instagram", "sa_ig"),
      ],
    });

    const { targets } = await h.service.create(
      USER,
      req({
        targets: [
          { socialConnectionId: "conn-tt", managementContentAssetId: "asset-916" },
          { socialConnectionId: "conn-ig", managementContentAssetId: "asset-916" },
        ],
      })
    );

    expect(h.bundles.consume).toHaveBeenCalledTimes(1);
    expect(h.bundles.consume.mock.calls[0][1]).toBe(2); // count = target count
    expect(h.publications.setTargetUploadBundle).toHaveBeenCalledTimes(2);
    expect(targets.every((t) => typeof t.uploadBundleId === "string")).toBe(true);
  });

  it("spends NO token when an access pass authorises the publish", async () => {
    const h = build({
      entitlement: {
        allowed: true,
        entitlementType: ManagementEntitlementType.ThreeMonths,
        accessPassId: "pass-1",
      },
    });

    await h.service.create(USER, req());

    expect(h.bundles.consume).not.toHaveBeenCalled();
    expect(h.publications.setTargetUploadBundle).not.toHaveBeenCalled();
  });

  it("refuses and cancels the publication when tokens were drained after the gate", async () => {
    // The gate passed, but a concurrent publish spent the tokens first. `consume`
    // returns null, so nothing is sent and the just-written publication is voided.
    const h = build({ consume: jest.fn(async () => null) });

    await expect(h.service.create(USER, req())).rejects.toMatchObject({
      name: "PublishNotEntitledError",
      reason: "payment_required",
    });
    expect(h.provider.createPost).not.toHaveBeenCalled();
    expect(h.publications.updateStatus).toHaveBeenCalledWith(
      "pub-1",
      ManagementPublicationStatus.Cancelled
    );
  });
});

describe("scheduling", () => {
  it("marks targets scheduled and passes the UTC instant to the provider", async () => {
    const when = future(2 * 60_000);
    const h = build();
    const { publication, targets } = await h.service.create(
      USER,
      req({ publishMode: ManagementPublishMode.Scheduled, scheduledAt: when, timezone: "Asia/Bangkok" })
    );

    expect(h.provider.createPost.mock.calls[0][0].scheduledAt).toEqual(when);
    expect(targets[0].status).toBe(ManagementPublicationTargetStatus.Scheduled);
    expect(publication.status).toBe(ManagementPublicationStatus.Scheduled);
    expect(h.content.updateStatus).toHaveBeenCalledWith(
      CONTENT_ID,
      ManagementContentStatus.Scheduled
    );
  });
});
