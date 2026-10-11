/**
 * Which requester pages a web browser is turned away from (BROWSER_MARKETING_ONLY).
 * Only video making is app-only; everything else must stay reachable on the web.
 */
import { isAppOnlyPath } from "@/config/studioRollout";

describe("isAppOnlyPath", () => {
  it("sends the video-making pages to the app", () => {
    expect(isAppOnlyPath("/studio")).toBe(true);
    expect(isAppOnlyPath("/studio/anything")).toBe(true);
    expect(isAppOnlyPath("/dashboard/requests/new")).toBe(true);
  });

  it("keeps every other requester page on the web", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/requests",
      "/dashboard/requests/abc-123",
      "/dashboard/management",
      "/dashboard/management/connections",
      "/dashboard/management/posts",
      "/dashboard/management/payments",
      "/dashboard/credits",
      "/dashboard/pricing",
      "/dashboard/legal",
      "/account",
    ]) {
      expect(isAppOnlyPath(path)).toBe(false);
    }
  });

  it("does not match look-alike paths", () => {
    expect(isAppOnlyPath("/studios")).toBe(false);
    expect(isAppOnlyPath("/dashboard/requests/newer")).toBe(false);
  });
});
