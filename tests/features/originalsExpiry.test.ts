/**
 * The app keeps picked originals ORIGINALS_KEPT_DAYS days, timed from when the
 * copy was written into the app (OPFS `lastModified`).
 */
import { isLocalMaterialExpired } from "@/features/requests/localMediaStore";
import { ORIGINALS_KEPT_DAYS, originalsExpireAt } from "@/config/localMedia";

const DAY = 86_400_000;

describe("originals keep window", () => {
  const now = Date.UTC(2026, 8, 27, 12);

  it("keeps a copy for exactly ORIGINALS_KEPT_DAYS days", () => {
    expect(ORIGINALS_KEPT_DAYS).toBe(7);
    expect(isLocalMaterialExpired({ lastModified: now - (ORIGINALS_KEPT_DAYS * DAY - 1) }, now)).toBe(false);
    expect(isLocalMaterialExpired({ lastModified: now - (ORIGINALS_KEPT_DAYS * DAY + 1) }, now)).toBe(true);
  });

  it("treats a copy without a usable time as fresh rather than deleting it", () => {
    expect(isLocalMaterialExpired({ lastModified: 0 }, now)).toBe(false);
    expect(isLocalMaterialExpired({ lastModified: Number.NaN }, now)).toBe(false);
  });

  it("dates the server backstop from the same window", () => {
    const since = new Date(now);
    expect(originalsExpireAt(since).getTime() - since.getTime()).toBe(ORIGINALS_KEPT_DAYS * DAY);
  });
});
