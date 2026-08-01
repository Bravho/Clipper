/**
 * ManagementUploadRetentionService — promoting paid uploads from the free 7-day
 * storage prefix to the 30-day one by moving the object (which resets the
 * bucket lifecycle clock).
 *
 * Pins: only user UPLOADS are touched (never transfers); only files still in the
 * free prefix move (already-retained files are left alone, so repeat purchases
 * do not re-copy); a move failure skips just that file; and the content's
 * media_expires_at is bumped only when something actually moved.
 */

jest.mock("@/lib/spaces", () => ({
  spacesMoveObject: jest.fn(),
  spacesSignedUrl: jest.fn(),
  spacesPublicUrl: jest.fn(),
  SIGNED_URL_TTL_SECONDS: 3600,
  SPACES_BUCKET: "test-bucket",
  spacesClient: {},
}));

import { ManagementUploadRetentionService } from "@/services/management/ManagementUploadRetentionService";
import { ManagementSourceType } from "@/domain/enums/ManagementStatus";

const USER = "user-1";

function item(id: string, sourceType: ManagementSourceType) {
  return { id, userId: USER, sourceType };
}

function asset(id: string, storageKey: string) {
  return { id, storageKey };
}

function build(opts: {
  items: ReturnType<typeof item>[];
  assetsByItem: Record<string, ReturnType<typeof asset>[]>;
  move?: jest.Mock;
}) {
  const updatedKeys: { assetId: string; key: string }[] = [];
  const expiryUpdates: { id: string; fields: Record<string, unknown> }[] = [];
  const content = {
    findByUserId: jest.fn(async () => opts.items),
    findAssets: jest.fn(async (id: string) => opts.assetsByItem[id] ?? []),
    updateAssetStorageKey: jest.fn(async (assetId: string, key: string) => {
      updatedKeys.push({ assetId, key });
    }),
    update: jest.fn(async (id: string, fields: Record<string, unknown>) => {
      expiryUpdates.push({ id, fields });
      return {};
    }),
  };
  const move = opts.move ?? jest.fn(async () => {});
  const audit = { record: jest.fn(async () => {}) };
  const service = new ManagementUploadRetentionService(
    content as never,
    move as never,
    audit as never
  );
  return { service, content, move, audit, updatedKeys, expiryUpdates };
}

describe("extendForUser", () => {
  it("moves an upload sitting in the free prefix and bumps its expiry", async () => {
    const h = build({
      items: [item("c1", ManagementSourceType.UserUpload)],
      assetsByItem: { c1: [asset("a1", "management_uploads/user-1/c1/x-vid.mp4")] },
    });

    const moved = await h.service.extendForUser(USER);

    expect(moved).toBe(1);
    expect(h.move).toHaveBeenCalledTimes(1);
    const [from, to] = h.move.mock.calls[0];
    expect(from).toBe("management_uploads/user-1/c1/x-vid.mp4");
    expect(to).toMatch(/^management_retained\/user-1\/c1\//);
    expect(h.updatedKeys[0]).toMatchObject({ assetId: "a1" });
    expect(h.updatedKeys[0].key).toMatch(/^management_retained\//);
    expect(h.expiryUpdates[0].id).toBe("c1");
    expect(h.expiryUpdates[0].fields.mediaExpiresAt).toBeInstanceOf(Date);
  });

  it("never touches transferred videos", async () => {
    const h = build({
      items: [item("c1", ManagementSourceType.RClipperGeneration)],
      assetsByItem: { c1: [asset("a1", "final_exports/user-1/2026-07-30/req/x.mp4")] },
    });
    const moved = await h.service.extendForUser(USER);
    expect(moved).toBe(0);
    expect(h.move).not.toHaveBeenCalled();
  });

  it("leaves already-retained uploads alone (idempotent across repeat purchases)", async () => {
    const h = build({
      items: [item("c1", ManagementSourceType.UserUpload)],
      assetsByItem: { c1: [asset("a1", "management_retained/user-1/c1/y-vid.mp4")] },
    });
    const moved = await h.service.extendForUser(USER);
    expect(moved).toBe(0);
    expect(h.move).not.toHaveBeenCalled();
    expect(h.expiryUpdates).toHaveLength(0);
  });

  it("skips a file whose move fails but still moves the rest", async () => {
    const move = jest
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(undefined);
    const h = build({
      items: [item("c1", ManagementSourceType.UserUpload)],
      assetsByItem: {
        c1: [
          asset("a1", "management_uploads/user-1/c1/one.mp4"),
          asset("a2", "management_uploads/user-1/c1/two.mp4"),
        ],
      },
      move,
    });

    const moved = await h.service.extendForUser(USER);

    expect(moved).toBe(1);
    expect(h.updatedKeys).toHaveLength(1);
    expect(h.updatedKeys[0].assetId).toBe("a2");
    // Something moved, so the expiry is still bumped.
    expect(h.expiryUpdates[0].id).toBe("c1");
  });
});
