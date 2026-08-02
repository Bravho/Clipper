/**
 * ManagementTransferService — per-video transfer.
 *
 * Each generated export becomes its own Management item, so a user can transfer
 * one video or all of them. These tests pin: the right asset is de-duplicated
 * per video, a foreign or non-export asset is refused, and "transfer all" is a
 * best-effort batch that skips a purged export rather than failing the lot.
 *
 * All dependencies are injected; nothing here needs a database.
 */

import {
  ManagementTransferService,
  ManagementTransferNotAllowedError,
} from "@/services/management/ManagementTransferService";
import { Platform } from "@/domain/enums/Platform";
import { eligibleExportAssetIds } from "@/services/management/ManagementEntitlementService";

const USER = { id: "user-1", email: "a@example.com", role: "requester" };
const SOURCE = "req-1";

function job() {
  return {
    id: "job-1",
    requestId: SOURCE,
    captionedExport_9_16_assetId: "asset-916",
    captionedExport_16_9_assetId: "asset-169",
    captionedExport_1_1_assetId: null,
    captionedExport_4_5_assetId: null,
    finalExport_9_16_assetId: null,
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_travy_assetId: null,
    publishingDrafts: [
      {
        platform: Platform.TikTok,
        title: "TikTok title",
        caption: "TikTok caption",
        hashtags: ["shortvideo"],
        locale: "en",
      },
      {
        platform: Platform.Facebook,
        title: "Facebook title",
        caption: "Facebook caption",
        hashtags: ["facebook"],
        locale: "en",
      },
      {
        platform: Platform.YouTube,
        title: "YouTube title",
        caption: "YouTube caption",
        hashtags: ["youtube"],
        locale: "en",
      },
    ],
  } as never;
}

function asset(id: string) {
  return {
    id,
    userId: USER.id,
    requestId: SOURCE,
    storageKey: `vids/${id}.mp4`,
    thumbnailKey: `thumbs/${id}.jpg`,
    mimeType: "video/mp4",
    durationSeconds: 30,
    videoRatio: null,
    fileName: `${id}.mp4`,
    fileSizeBytes: 1000,
  } as never;
}

interface Opts {
  eligibilityAllowed?: boolean;
  assetById?: (id: string) => unknown;
  generationJob?: unknown;
  /**
   * Force the "this video was already transferred" branch, with the item's
   * thumbnail left as-is — that is the state a pre-poster transfer left behind.
   */
  existingItemThumbnail?: string | null;
  /** Stub poster generator; defaults to one that succeeds. */
  ensurePoster?: (assetId: string) => Promise<{ key: string; url: string } | null>;
}

function build(o: Opts = {}) {
  const requests = {
    findById: jest.fn(async () => ({
      id: SOURCE,
      userId: USER.id,
      title: "My Clip",
      description: null,
      targetPlatforms: [
        Platform.TikTok,
        Platform.Facebook,
        Platform.YouTube,
        Platform.TravyApp,
      ],
    })),
  };
  const jobs = { findByRequestId: jest.fn(async () => o.generationJob ?? job()) };
  const assets = {
    findById: jest.fn(async (id: string) =>
      o.assetById ? o.assetById(id) : asset(id)
    ),
  };
  const preExisting = o.existingItemThumbnail !== undefined;
  const content = {
    createOrGetTransferredVideo: jest.fn(async (input: Record<string, unknown>) => ({
      item: {
        id: `item-${input.sourceAssetId}`,
        userId: input.userId,
        sourceGenerationId: input.sourceGenerationId,
        sourceAssetId: input.sourceAssetId,
        title: input.title,
        status: "ready",
        mediaExpiresAt: new Date(),
        thumbnailStorageKey: preExisting
          ? o.existingItemThumbnail
          : (input.thumbnailStorageKey as string | null),
      },
      // An existing row means the INSERT did nothing — the branch where the
      // thumbnail can only be fixed by a follow-up UPDATE.
      created: !preExisting,
    })),
    update: jest.fn(async (id: string, fields: Record<string, unknown>) => ({
      id,
      ...fields,
    })),
    replaceAssets: jest.fn(async (_id: string, rows: unknown[]) => rows),
    replaceChannelSuggestions: jest.fn(async (_id: string, rows: unknown[]) => rows),
    updateStatus: jest.fn(async () => ({})),
  };
  const ensurePoster = jest.fn(
    o.ensurePoster ??
      (async (assetId: string) => ({
        key: `thumbs/generated-${assetId}.jpg`,
        url: `https://cdn.example/thumbs/generated-${assetId}.jpg`,
      }))
  );
  const entitlements = {
    checkTransferEligibility: jest.fn(async () => ({
      allowed: o.eligibilityAllowed ?? true,
      alreadyTransferred: false,
      videoCount: 2,
      reason: o.eligibilityAllowed === false ? "generation_incomplete" : undefined,
    })),
  };
  const audit = { record: jest.fn(async () => {}) };

  const service = new ManagementTransferService(
    requests as never,
    jobs as never,
    assets as never,
    content as never,
    entitlements as never,
    audit as never,
    ensurePoster as never
  );
  return { service, requests, jobs, assets, content, entitlements, audit, ensurePoster };
}

describe("transferVideo", () => {
  it("creates a per-video item for the chosen export, keyed by its asset", async () => {
    const h = build();
    const result = await h.service.transferVideo({
      user: USER,
      sourceGenerationId: SOURCE,
      assetId: "asset-916",
    });

    expect(h.content.createOrGetTransferredVideo).toHaveBeenCalledTimes(1);
    const arg = h.content.createOrGetTransferredVideo.mock.calls[0][0];
    expect(arg.sourceAssetId).toBe("asset-916");
    expect(arg.title).toContain("9:16");
    // One asset row, for this video only.
    expect(h.content.replaceAssets.mock.calls[0][1]).toHaveLength(1);
    expect(h.content.replaceChannelSuggestions.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        platform: Platform.TikTok,
        displayOrder: 0,
        caption: "TikTok caption",
        hashtags: ["shortvideo"],
      }),
    ]);
    expect(result.content.sourceAssetId).toBe("asset-916");
  });

  it("carries every selected channel that shares the transferred ratio", async () => {
    const h = build();
    await h.service.transferVideo({
      user: USER,
      sourceGenerationId: SOURCE,
      assetId: "asset-169",
    });

    const suggestions = h.content.replaceChannelSuggestions.mock.calls[0][1];
    expect(suggestions).toEqual([
      expect.objectContaining({
        platform: Platform.Facebook,
        displayOrder: 0,
        caption: "Facebook caption",
      }),
      expect.objectContaining({
        platform: Platform.YouTube,
        displayOrder: 1,
        title: "YouTube title",
        caption: "YouTube caption",
      }),
    ]);
    expect(suggestions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ platform: Platform.TravyApp })])
    );
  });

  it("refuses an asset that is not one of this project's exports", async () => {
    const h = build();
    await expect(
      h.service.transferVideo({ user: USER, sourceGenerationId: SOURCE, assetId: "ghost" })
    ).rejects.toThrow(/not an eligible export/);
    expect(h.content.createOrGetTransferredVideo).not.toHaveBeenCalled();
  });

  it("refuses an export asset owned by someone else", async () => {
    const h = build({
      assetById: (id) => ({ ...(asset(id) as object), userId: "someone-else" }),
    });
    await expect(
      h.service.transferVideo({ user: USER, sourceGenerationId: SOURCE, assetId: "asset-916" })
    ).rejects.toThrow(/no longer available/);
  });

  it("propagates a transfer-not-allowed eligibility as a typed error", async () => {
    const h = build({ eligibilityAllowed: false });
    await expect(
      h.service.transferVideo({ user: USER, sourceGenerationId: SOURCE, assetId: "asset-916" })
    ).rejects.toBeInstanceOf(ManagementTransferNotAllowedError);
  });

  describe("preview image", () => {
    it("reuses the export's existing poster without regenerating one", async () => {
      const h = build();
      await h.service.transferVideo({
        user: USER,
        sourceGenerationId: SOURCE,
        assetId: "asset-916",
      });

      const arg = h.content.createOrGetTransferredVideo.mock.calls[0][0];
      expect(arg.thumbnailStorageKey).toBe("thumbs/asset-916.jpg");
      expect(h.ensurePoster).not.toHaveBeenCalled();
    });

    it("generates a poster when the export has none", async () => {
      const h = build({
        assetById: (id) => ({ ...(asset(id) as object), thumbnailKey: "" }),
      });
      await h.service.transferVideo({
        user: USER,
        sourceGenerationId: SOURCE,
        assetId: "asset-916",
      });

      expect(h.ensurePoster).toHaveBeenCalledWith("asset-916");
      const arg = h.content.createOrGetTransferredVideo.mock.calls[0][0];
      expect(arg.thumbnailStorageKey).toBe("thumbs/generated-asset-916.jpg");
    });

    it("transfers anyway when no poster can be produced", async () => {
      const h = build({
        assetById: (id) => ({ ...(asset(id) as object), thumbnailKey: "" }),
        ensurePoster: async () => null,
      });
      const result = await h.service.transferVideo({
        user: USER,
        sourceGenerationId: SOURCE,
        assetId: "asset-916",
      });

      expect(result.content.sourceAssetId).toBe("asset-916");
      expect(
        h.content.createOrGetTransferredVideo.mock.calls[0][0].thumbnailStorageKey
      ).toBeNull();
    });

    it("repairs an already-transferred item whose thumbnail was never set", async () => {
      const h = build({ existingItemThumbnail: null });
      await h.service.transferVideo({
        user: USER,
        sourceGenerationId: SOURCE,
        assetId: "asset-916",
      });

      // The INSERT was a no-op, so the key can only arrive via UPDATE.
      expect(h.content.update).toHaveBeenCalledWith("item-asset-916", {
        thumbnailStorageKey: "thumbs/asset-916.jpg",
      });
    });

    it("leaves an already-transferred item's existing thumbnail alone", async () => {
      const h = build({ existingItemThumbnail: "thumbs/already-there.jpg" });
      await h.service.transferVideo({
        user: USER,
        sourceGenerationId: SOURCE,
        assetId: "asset-916",
      });

      expect(h.content.update).not.toHaveBeenCalled();
    });
  });
});

describe("transferAll", () => {
  it("transfers every eligible export as its own item", async () => {
    const h = build();
    const { items, createdCount } = await h.service.transferAll({
      user: USER,
      sourceGenerationId: SOURCE,
    });
    expect(items).toHaveLength(2);
    expect(createdCount).toBe(2);
    const assetIds = h.content.createOrGetTransferredVideo.mock.calls.map(
      (c) => c[0].sourceAssetId
    );
    expect(assetIds.sort()).toEqual(["asset-169", "asset-916"]);
  });

  it("skips an export whose media is gone but still transfers the rest", async () => {
    const h = build({ assetById: (id) => (id === "asset-169" ? null : asset(id)) });
    const { items } = await h.service.transferAll({
      user: USER,
      sourceGenerationId: SOURCE,
    });
    expect(items).toHaveLength(1);
    expect(items[0].content.sourceAssetId).toBe("asset-916");
  });

  it("does not transfer the Travy-specific export", async () => {
    const h = build({
      generationJob: {
        ...(job() as object),
        finalExport_travy_assetId: "asset-travy",
      },
    });

    const { items, createdCount } = await h.service.transferAll({
      user: USER,
      sourceGenerationId: SOURCE,
    });

    expect(items).toHaveLength(2);
    expect(createdCount).toBe(2);
    expect(h.assets.findById).not.toHaveBeenCalledWith("asset-travy");
    expect(
      h.content.createOrGetTransferredVideo.mock.calls.map(
        (call) => call[0].sourceAssetId
      )
    ).not.toContain("asset-travy");
  });

  it("keeps the ordinary 16:9 export when Travy reuses that asset", () => {
    const exports = eligibleExportAssetIds({
      ...(job() as object),
      finalExport_travy_assetId: "asset-169",
    } as never);

    expect(exports.map((entry) => entry.assetId)).toEqual(["asset-916", "asset-169"]);
    expect(exports.find((entry) => entry.assetId === "asset-169")?.variant).toBe("16:9");
  });
});
