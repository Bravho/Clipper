import {
  managementPaymentsPath,
  managementPublishReturnPath,
  ROUTES,
  safeManagementReturnPath,
} from "@/config/routes";

describe("Channel Management package return paths", () => {
  it("carries the originating video through the package URL", () => {
    const returnTo = managementPublishReturnPath("video-1");

    expect(returnTo).toBe(
      "/dashboard/management?publish=video-1#management-video-video-1"
    );
    expect(managementPaymentsPath(returnTo)).toBe(
      "/dashboard/management/payments?returnTo=%2Fdashboard%2Fmanagement%3Fpublish%3Dvideo-1%23management-video-video-1"
    );
  });

  it("allows management pages, queries, and item anchors", () => {
    expect(
      safeManagementReturnPath(
        "/dashboard/management?publish=video-1#management-video-video-1"
      )
    ).toBe(
      "/dashboard/management?publish=video-1#management-video-video-1"
    );
    expect(
      safeManagementReturnPath("/dashboard/management/content")
    ).toBe("/dashboard/management/content");
  });

  it.each([
    undefined,
    "https://example.com/dashboard/management",
    "//example.com/dashboard/management",
    "/dashboard/management-elsewhere",
    "/dashboard/management/payments?returnTo=/dashboard/management",
  ])("falls back to the management hub for unsafe destinations", (value) => {
    expect(safeManagementReturnPath(value)).toBe(ROUTES.MANAGEMENT);
  });
});
