import { AD_LAB_CONFIG, adLabRolloutBucket, isAdLabEnabledFor, isAdLabPath } from "@/config/adLab";

const original = { ...process.env };

describe("Ad Lab access", () => {
  afterEach(() => {
    process.env = { ...original };
  });

  it("is off by default", () => {
    delete process.env.RCLIPPER_STUDIO_ENABLED;
    delete process.env.RCLIPPER_AD_LAB_ENABLED;
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "owner@example.com";
    expect(isAdLabEnabledFor({ id: "owner", email: "owner@example.com" })).toBe(false);
  });

  it("still denies everyone when enabled without an allowlist", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    delete process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS;
    delete process.env.RCLIPPER_STUDIO_ALLOWED_USER_IDS;
    expect(isAdLabEnabledFor({ id: "owner", email: "owner@example.com" })).toBe(false);
  });

  it("matches email and user id case-insensitively", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "OWNER@example.com";
    process.env.RCLIPPER_STUDIO_ALLOWED_USER_IDS = "USER-2";
    expect(isAdLabEnabledFor({ id: "x", email: "owner@example.com" })).toBe(true);
    expect(isAdLabEnabledFor({ id: "user-2", email: null })).toBe(true);
  });

  it("does not grant access to an unlisted user", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "owner@example.com";
    expect(isAdLabEnabledFor({ id: "other", email: "other@example.com" })).toBe(false);
  });

  it("reads the RCLIPPER_AD_LAB_* names, preferring them over the old ones", () => {
    process.env.RCLIPPER_AD_LAB_ENABLED = "true";
    process.env.RCLIPPER_AD_LAB_ALLOWED_EMAILS = "new@example.com";
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "old@example.com";
    expect(isAdLabEnabledFor({ id: "a", email: "new@example.com" })).toBe(true);
    expect(isAdLabEnabledFor({ id: "b", email: "old@example.com" })).toBe(false);
  });

  it("lets the new switch turn the lab off even if the old one is on", () => {
    process.env.RCLIPPER_STUDIO_ENABLED = "true";
    process.env.RCLIPPER_AD_LAB_ENABLED = "false";
    process.env.RCLIPPER_STUDIO_ALLOWED_EMAILS = "owner@example.com";
    expect(isAdLabEnabledFor({ id: "owner", email: "owner@example.com" })).toBe(false);
  });

  it("ignores an empty user id instead of matching an empty allowlist entry", () => {
    process.env.RCLIPPER_AD_LAB_ENABLED = "true";
    process.env.RCLIPPER_AD_LAB_ALLOWED_USER_IDS = "user-1";
    expect(isAdLabEnabledFor({ id: "", email: null })).toBe(false);
    expect(isAdLabEnabledFor({ id: undefined, email: undefined })).toBe(false);
  });

  it("recognises only Ad Lab paths — never the phone studio", () => {
    expect(isAdLabPath("/dashboard/ad-lab")).toBe(true);
    expect(isAdLabPath("/dashboard/ad-lab/create")).toBe(true);
    expect(isAdLabPath("/api/ad-lab/workspace")).toBe(true);
    expect(isAdLabPath("/studio")).toBe(false);
    expect(isAdLabPath("/dashboard/ad-labx")).toBe(false);
    expect(isAdLabPath("/dashboard/management")).toBe(false);
  });

  it("accepts only known storage modes", () => {
    process.env.RCLIPPER_AD_LAB_STORE = "Postgres";
    expect(AD_LAB_CONFIG.store).toBe("postgres");
    process.env.RCLIPPER_AD_LAB_STORE = "mongo";
    expect(AD_LAB_CONFIG.store).toBeNull();
  });

  it("opens to an email domain and to a stable rollout percentage", () => {
    process.env.RCLIPPER_AD_LAB_ENABLED = "true";
    process.env.RCLIPPER_AD_LAB_ALLOWED_EMAIL_DOMAINS = "client.co.th";
    expect(isAdLabEnabledFor({ id: "u1", email: "staff@client.co.th" })).toBe(true);
    expect(isAdLabEnabledFor({ id: "u1", email: "staff@other.com" })).toBe(false);

    delete process.env.RCLIPPER_AD_LAB_ALLOWED_EMAIL_DOMAINS;
    process.env.RCLIPPER_AD_LAB_ROLLOUT_PERCENT = "100";
    expect(isAdLabEnabledFor({ id: "anyone", email: "x@y.com" })).toBe(true);
    process.env.RCLIPPER_AD_LAB_ROLLOUT_PERCENT = "0";
    expect(isAdLabEnabledFor({ id: "anyone", email: "x@y.com" })).toBe(false);
  });

  it("keeps everyone out when the master switch is off, whatever the rollout", () => {
    process.env.RCLIPPER_AD_LAB_ENABLED = "false";
    process.env.RCLIPPER_AD_LAB_ROLLOUT_PERCENT = "100";
    expect(isAdLabEnabledFor({ id: "anyone", email: "x@y.com" })).toBe(false);
  });

  it("buckets users stably into 0–99", () => {
    const bucket = adLabRolloutBucket("user-123");
    expect(bucket).toBe(adLabRolloutBucket("user-123"));
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
  });
});
