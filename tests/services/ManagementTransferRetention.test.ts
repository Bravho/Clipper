/**
 * ManagementTransferRetentionService — promoting a paying user's TRANSFERRED
 * generation videos into the paid management_retained/ window.
 *
 * Pins: only transferred items are touched (never uploads); a clip still under
 * the generation prefix is COPIED in (generation keeps its own copy) while one
 * already retained is MOVED (clock reset); a failure skips just that file; and
 * media_expires_at is bumped only when something was relocated.
 */

jest.mock("@/lib/spaces", () => ({
  spacesCopyObject: jest.fn(),
  spacesMoveObject: jest.fn(),
  spacesSignedUrl: jest.fn(),
  spacesPublicUrl: jest.fn(),
  SIGNED_URL_TTL_SECONDS: 3600,
  SPACES_BUCKET: "test-bucket",
  spacesClient: {},
}));

import { ManagementTransferRetentionService } from "@/services/management/ManagementTransferRetentionService";
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
  copy?: jest.Mock;
  move?: jest.Mock;
}) {
  const updatedKeys: { assetId: string; key: string }[] = [];
  const updates: { id: string; fields: Record<string, unknown> }[] = [];
  const content = {
    findByUserId: jest.fn(async () => opts.items),
    findAssets: jest.fn(async (id: string) => opts.assetsByItem[id] ?? []),
    updateAssetStorageKey: jest.fn(async (assetId: string, key: string) => {
      updatedKeys.push({ assetId, key });
    }),
    update: jest.fn(async (id: string, fields: Record<string, unknown>) => {
      updates.push({ id, fields });
      return {};
    }),
  };
  const copy = opts.copy ?? jest.fn(async () => {});
  const move = opts.move ?? jest.fn(async () => {});
  const audit = { record: jest.fn(async () => {}) };
  const service = new ManagementTransferRetentionService(
    content as never,
    copy as never,
    move as never,
    audit as never
  );
  return { service, content, copy, move, updatedKeys, updates };
}

describe("extendForUser (paid transfer promotion)", () => {
  it("copies a generation-referenced clip into management_retained and bumps expiry", async () => {
    const h = build({
      items: [item("c1", ManagementSourceType.RClipperGeneration)],
      assetsByItem: {
        c1: [asset("a1", "final_exports/user-1/2026-07-30/req/9-16/x.mp4")],
      },
    });

    const moved = await h.service.extendForUser(USER);

    expect(moved).toBe(1);
    expect(h.copy).toHaveBeenCalledTimes(1);
    expect(h.move).not.toHaveBeenCalled();
    const [from, to] = h.copy.mock.calls[0];
    expect(from).toBe("final_exports/user-1/2026-07-30/req/9-16/x.mp4");
    expect(to).toMatch(/^management_retained\/user-1\/c1\//);
    expect(h.updatedKeys[0]).toMatchObject({ assetId: "a1" });
    expect(h.updatedKeys[0].key).toMatch(/^management_retained\//);
    expect(h.updates[0].fields.mediaExpiresAt).toBeInstanceOf(Date);
  });

  it("re-keys (moves) a clip already in management_retained to reset its clock", async () => {
    const h = build({
      items: [item("c1", ManagementSourceType.RClipperGeneration)],
      assetsByItem: {
        c1: [asset("a1", "management_retained/user-1/c1/old.mp4")],
      },
    });

    const moved = await h.service.extendForUser(USER);

    expect(moved).toBe(1);
    expect(h.move).toHaveBeenCalledTimes(1);
    expect(h.copy).not.toHaveBeenCalled();
    expect(h.updatedKeys[0].key).toMatch(/^management_retained\//);
  });

  it("never touches user uploads", async () => {
    const h = build({
      items: [item("c1", ManagementSourceType.UserUpload)],
      assetsByItem: { c1: [asset("a1", "management_uploads/user-1/c1/x.mp4")] },
    });
    const moved = await h.service.extendForUser(USER);
    expect(moved).toBe(0);
    expect(h.copy).not.toHaveBeenCalled();
    expect(h.move).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("skips a clip whose relocation fails but promotes the rest", async () => {
    const copy = jest
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(undefined);
    const h = build({
      items: [item("c1", ManagementSourceType.RClipperGeneration)],
      assetsByItem: {
        c1: [
          asset("a1", "final_exports/user-1/d/req/9-16/one.mp4"),
          asset("a2", "final_exports/user-1/d/req/1-1/two.mp4"),
        ],
      },
      copy,
    });

    const moved = await h.service.extendForUser(USER);

    expect(moved).toBe(1);
    expect(h.updatedKeys).toHaveLength(1);
    expect(h.updatedKeys[0].assetId).toBe("a2");
    expect(h.updates[0].fields.mediaExpiresAt).toBeInstanceOf(Date);
  });
});
