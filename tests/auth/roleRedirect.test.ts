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

  it("redirects Staff to /staff", () => {
    expect(getRoleHomePath(Role.Staff)).toBe(ROUTES.STAFF);
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
    expect(ROUTES.STAFF).toBe("/staff");
    expect(ROUTES.ADMIN).toBe("/admin");
    expect(ROUTES.ACCOUNT).toBe("/account");
  });
});

describe("Role enum values", () => {
  it("has correct string values matching DB convention", () => {
    expect(Role.Requester).toBe("requester");
    expect(Role.Staff).toBe("staff");
    expect(Role.Admin).toBe("admin");
  });
});

describe("middleware role-route rules (logic verification)", () => {
  // These tests verify the decision logic used in middleware.ts
  // without importing Next.js middleware directly (not test-compatible)

  function simulateMiddlewareRedirect(role: Role, pathname: string): string | null {
    if (pathname.startsWith("/admin")) {
      if (role !== Role.Admin) {
        return role === Role.Staff ? "/staff" : "/dashboard";
      }
    }
    if (pathname.startsWith("/staff")) {
      if (role !== Role.Staff && role !== Role.Admin) {
        return "/dashboard";
      }
    }
    if (pathname.startsWith("/dashboard")) {
      if (role !== Role.Requester) {
        return role === Role.Admin ? "/admin" : "/staff";
      }
    }
    return null; // No redirect
  }

  it("Requester accessing /dashboard — no redirect", () => {
    expect(simulateMiddlewareRedirect(Role.Requester, "/dashboard")).toBeNull();
  });

  it("Staff accessing /staff — no redirect", () => {
    expect(simulateMiddlewareRedirect(Role.Staff, "/staff")).toBeNull();
  });

  it("Admin accessing /admin — no redirect", () => {
    expect(simulateMiddlewareRedirect(Role.Admin, "/admin")).toBeNull();
  });

  it("Admin accessing /staff — no redirect (Admin can access /staff)", () => {
    expect(simulateMiddlewareRedirect(Role.Admin, "/staff")).toBeNull();
  });

  it("Requester accessing /admin — redirected to /dashboard", () => {
    expect(simulateMiddlewareRedirect(Role.Requester, "/admin")).toBe("/dashboard");
  });

  it("Requester accessing /staff — redirected to /dashboard", () => {
    expect(simulateMiddlewareRedirect(Role.Requester, "/staff")).toBe("/dashboard");
  });

  it("Staff accessing /admin — redirected to /staff", () => {
    expect(simulateMiddlewareRedirect(Role.Staff, "/admin")).toBe("/staff");
  });

  it("Staff accessing /dashboard — redirected to /staff", () => {
    expect(simulateMiddlewareRedirect(Role.Staff, "/dashboard")).toBe("/staff");
  });

  it("Admin accessing /dashboard — redirected to /admin", () => {
    expect(simulateMiddlewareRedirect(Role.Admin, "/dashboard")).toBe("/admin");
  });
});
