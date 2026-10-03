import {
  isAdLabLocalAuthEnabled,
  isAdLabLocalUserId,
  verifyAdLabLocalCredentials,
} from "@/lib/auth/adLabLocalCredentials";

const originalEnv = { ...process.env };

describe("Ad Lab local credentials", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      RCLIPPER_STUDIO_ENABLED: "true",
      RCLIPPER_STUDIO_LOCAL_AUTH_ENABLED: "true",
      RCLIPPER_STUDIO_LOCAL_EMAIL: "owner@example.com",
      RCLIPPER_STUDIO_LOCAL_PASSWORD: "local-secret",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("accepts the configured email and password", () => {
    expect(isAdLabLocalAuthEnabled()).toBe(true);
    expect(verifyAdLabLocalCredentials("OWNER@example.com", "local-secret")).toMatchObject({
      id: "studio-local-owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    expect(isAdLabLocalUserId("studio-local-owner")).toBe(true);
  });

  it("rejects an incorrect password", () => {
    expect(verifyAdLabLocalCredentials("owner@example.com", "wrong")).toBeNull();
  });

  it("cannot be enabled in production", () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    expect(isAdLabLocalAuthEnabled()).toBe(false);
    expect(verifyAdLabLocalCredentials("owner@example.com", "local-secret")).toBeNull();
  });
});
