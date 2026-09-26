import { canAccessDeviceRenderLab } from "@/lib/mobile/deviceRenderLabAccess";

describe("production Phone render lab access", () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalMode = process.env.NODE_ENV;
  const originalEmail = process.env.DEVICE_RENDER_LAB_TEST_EMAIL;

  beforeEach(() => {
    mutableEnv.NODE_ENV = "production";
    delete process.env.DEVICE_RENDER_LAB_TEST_EMAIL;
  });

  afterAll(() => {
    mutableEnv.NODE_ENV = originalMode;
    if (originalEmail === undefined) delete process.env.DEVICE_RENDER_LAB_TEST_EMAIL;
    else process.env.DEVICE_RENDER_LAB_TEST_EMAIL = originalEmail;
  });

  it("hides the route when no tester is configured", () => {
    expect(canAccessDeviceRenderLab("tester@example.com")).toBe(false);
  });

  it("accepts only the configured signed-in email", () => {
    process.env.DEVICE_RENDER_LAB_TEST_EMAIL = " Tester@Example.com ";
    expect(canAccessDeviceRenderLab(null)).toBe(false);
    expect(canAccessDeviceRenderLab("other@example.com")).toBe(false);
    expect(canAccessDeviceRenderLab("tester@example.com")).toBe(true);
  });
});
