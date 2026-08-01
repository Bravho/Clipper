/**
 * PaidExportRetentionService — on a paid download unlock, the clean FinalClip
 * masters move from final_exports/ (short window) into paid_exports/ (30-day),
 * which resets the bucket lifecycle clock.
 *
 * Pins: only FinalClip assets still under final_exports/ move (previews and
 * already-promoted masters are left alone, so a repeat unlock is a no-op); a move
 * failure skips just that file; each moved asset is repointed to its new key.
 */

jest.mock("@/lib/spaces", () => ({
  spacesMoveObject: jest.fn(),
  spacesPublicUrl: jest.fn((k: string) => `https://cdn.test/${k}`),
  SPACES_BUCKET: "test-bucket",
  spacesClient: {},
}));

import { PaidExportRetentionService } from "@/services/PaidExportRetentionService";
import { AssetType } from "@/domain/enums/AssetType";

const USER = "user-1";
const REQ = "req-1";

function asset(id: string, assetType: AssetType, storageKey: string) {
  return { id, assetType, storageKey };
}

function build(opts: { assets: ReturnType<typeof asset>[]; move?: jest.Mock }) {
  const updates: { id: string; fields: Record<string, unknown> }[] = [];
  const assets = {
    findByRequestId: jest.fn(async () => opts.assets),
    update: jest.fn(async (id: string, fields: Record<string, unknown>) => {
      updates.push({ id, fields });
      return {};
    }),
  };
  const move = opts.move ?? jest.fn(async () => {});
  const service = new PaidExportRetentionService(assets as never, move as never);
  return { service, assets, move, updates };
}

describe("promoteForRequest", () => {
  it("moves a FinalClip master out of final_exports/ and repoints it", async () => {
    const h = build({
      assets: [
        asset("a1", AssetType.FinalClip, `final_exports/${USER}/2026-07-31/${REQ}/9-16/x.mp4`),
      ],
    });

    const moved = await h.service.promoteForRequest(USER, REQ);

    expect(moved).toBe(1);
    expect(h.move).toHaveBeenCalledTimes(1);
    const [from, to] = h.move.mock.calls[0];
    expect(from).toBe(`final_exports/${USER}/2026-07-31/${REQ}/9-16/x.mp4`);
    expect(to).toMatch(new RegExp(`^paid_exports/${USER}/\\d{4}-\\d{2}-\\d{2}/${REQ}/`));
    expect(h.updates[0].id).toBe("a1");
    expect(h.updates[0].fields.storageKey).toMatch(/^paid_exports\//);
    expect(h.updates[0].fields.storageUrl).toMatch(/^https:\/\/cdn\.test\/paid_exports\//);
  });

  it("ignores previews and non-final assets", async () => {
    const h = build({
      assets: [
        asset("a1", AssetType.WatermarkedPreview, `preview_exports/${USER}/d/${REQ}/9-16/w.mp4`),
        asset("a2", AssetType.FinalClip, `ai_videos/${USER}/d/${REQ}/base.mp4`), // wrong prefix
      ],
    });
    const moved = await h.service.promoteForRequest(USER, REQ);
    expect(moved).toBe(0);
    expect(h.move).not.toHaveBeenCalled();
  });

  it("is idempotent — already-promoted masters are left alone", async () => {
    const h = build({
      assets: [
        asset("a1", AssetType.FinalClip, `paid_exports/${USER}/d/${REQ}/x-y.mp4`),
      ],
    });
    const moved = await h.service.promoteForRequest(USER, REQ);
    expect(moved).toBe(0);
    expect(h.move).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("skips a file whose move fails but still moves the rest", async () => {
    const move = jest
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(undefined);
    const h = build({
      assets: [
        asset("a1", AssetType.FinalClip, `final_exports/${USER}/d/${REQ}/one.mp4`),
        asset("a2", AssetType.FinalClip, `final_exports/${USER}/d/${REQ}/two.mp4`),
      ],
      move,
    });

    const moved = await h.service.promoteForRequest(USER, REQ);

    expect(moved).toBe(1);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].id).toBe("a2");
  });
});
