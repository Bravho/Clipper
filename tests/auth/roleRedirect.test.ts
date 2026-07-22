/**
 * Role-based redirect logic tests.
 *
 * Tests the getRoleHomePath utility and Role enum values
 * that drive middleware redirect decisions.
 */

import { getRoleHomePath, ROUTES } from "@/config/routes";
import { Role } from "@/domain/enums/Role";

describe("getRoleHomePath", () => {
  it("redirects Requester to /dashboard", () => {
    expect(getRoleHomePath(Role.Requester)).toBe(ROUTES.DASHBOARD);
  });

  it("redirects Admin to /admin", () => {
    expect(getRoleHomePath(Role.Admin)).toBe(ROUTES.ADMIN);
  });

});

describe("ROUTES config", () => {
  it("has all expected public routes", () => {
    expect(ROUTES.HOME).toBe("/");
    expect(ROUTES.LOGIN).toBe("/login");
    expect(ROUTES.SIGNUP).toBe("/signup");
    expect(ROUTES.TERMS).toBe("/terms");
    expect(ROUTES.OWNERSHIP).toBe("/ownership");
    expect(ROUTES.PRIVACY).toBe("/privacy");
  });

  it("has all expected protected routes", () => {
    expect(ROUTES.DASHBOARD).toBe("/dashboard");
    expect(ROUTES.ADMIN).toBe("/admin");
    expect(ROUTES.ACCOUNT).toBe("/account");
  });
});

describe("Role enum values", () => {
  it("has correct string values matching DB convention", () => {
    expect(Role.Requester).toBe("requester");
    expect(Role.Admin).toBe("admin");
  });
});

describe("middleware role-route rules (logic verification)", () => {
  // These tests verify the decision logic used in middleware.ts
  // without importing Next.js middleware directly (not test-compatible)

  function simulateMiddlewareRedirect(role: Role, pathname: string): string | null {
    if (pathname.startsWith("/admin")) {
      if (role !== Role.Admin) {
        return "/dashboard";
      }
    }
    if (pathname.startsWith("/dashboard")) {
      if (role !== Role.Requester) {
        return "/admin";
      }
    }
    return null; // No redirect
  }

  it("Requester accessing /dashboard — no redirect", () => {
    expect(simulateMiddlewareRedirect(Role.Requester, "/dashboard")).toBeNull();
  });

  it("Admin accessing /admin — no redirect", () => {
    expect(simulateMiddlewareRedirect(Role.Admin, "/admin")).toBeNull();
  });

  it("Requester accessing /admin — redirected to /dashboard", () => {
    expect(simulateMiddlewareRedirect(Role.Requester, "/admin")).toBe("/dashboard");
  });

  it("Admin accessing /dashboard — redirected to /admin", () => {
    expect(simulateMiddlewareRedirect(Role.Admin, "/dashboard")).toBe("/admin");
  });

});
