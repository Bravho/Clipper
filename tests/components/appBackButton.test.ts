import { isTopLevelPath, parentPath } from "@/components/mobile/appBackPaths";


describe("AppBackButton paths", () => {
  it("treats the app's top pages as having no back", () => {
    for (const path of ["/", "/dashboard", "/dashboard/", "/admin", "/login"]) {
      expect(isTopLevelPath(path)).toBe(true);
    }
    for (const path of ["/studio", "/dashboard/pricing", "/dashboard/requests/abc", "/account"]) {
      expect(isTopLevelPath(path)).toBe(false);
    }
  });

  it("goes one level up when there is no history", () => {
    expect(parentPath("/dashboard/requests/abc")).toBe("/dashboard/requests");
    expect(parentPath("/dashboard/pricing")).toBe("/dashboard");
    expect(parentPath("/studio")).toBe("/dashboard");
    expect(parentPath("/account")).toBe("/dashboard");
    expect(parentPath("/admin/analytics/funnel")).toBe("/admin");
  });
});
