import { isStudioEnabledFor } from "@/config/studio";

const original = { ...process.env };

describe("Studio Lab access", () => {
  afterEach(() => {
    process.env = { ...original };
  });

  it("is off by default", () => {
    delete process.env.RCLIPPER_STUDIO_ENABLED;
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "owner@example.com";
    expect(isStudioEnabledFor({ id: "owner", email: "owner@example.com" })).toBe(false);
  });

  it("still denies everyone when enabled without an allowlist", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    delete process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS;
    delete process.env.RCLIPPER_STUDIO_ALLOWED_USER_IDS;
    expect(isStudioEnabledFor({ id: "owner", email: "owner@example.com" })).toBe(false);
  });

  it("matches email and user id case-insensitively", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "OWNER@example.com";
    process.env.RCLIPPER_STUDIO_ALLOWED_USER_IDS = "USER-2";
    expect(isStudioEnabledFor({ id: "x", email: "owner@example.com" })).toBe(true);
    expect(isStudioEnabledFor({ id: "user-2", email: null })).toBe(true);
  });

  it("does not grant access to an unlisted user", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "owner@example.com";
    expect(isStudioEnabledFor({ id: "other", email: "other@example.com" })).toBe(false);
  });
});
