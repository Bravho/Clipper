/**
 * Provider layer: error classification, webhook verification, token stripping
 * and log redaction.
 *
 * These are the parts where a mistake is expensive rather than merely annoying:
 * a mis-classified error reposts a video, a weak webhook check lets anyone write
 * to our database, and a leaked token is a customer's social account.
 */

import {
  SocialPublishingError,
  classifyTargetError,
  codeForHttpStatus,
} from "@/services/social-publishing/errors";
import { redact } from "@/services/social-publishing/post-for-me/client";
import { verifyAndParseWebhook } from "@/services/social-publishing/post-for-me/webhooks";
import {
  toConnectedAccount,
  toTargetResult,
  lifecycleToTargetStatus,
} from "@/services/social-publishing/post-for-me/mappings";
import { isSocialPlatform, SOCIAL_PLATFORMS } from "@/services/social-publishing/types";

describe("HTTP status classification", () => {
  it("treats 429 and 5xx as retryable", () => {
    expect(new SocialPublishingError(codeForHttpStatus(429), "x").retryable).toBe(true);
    expect(new SocialPublishingError(codeForHttpStatus(500), "x").retryable).toBe(true);
    expect(new SocialPublishingError(codeForHttpStatus(503), "x").retryable).toBe(true);
  });

  it("treats auth failures as PERMANENT", () => {
    // Retrying a bad or revoked project key cannot succeed, and hammering the
    // provider with it risks the whole project's access.
    expect(new SocialPublishingError(codeForHttpStatus(401), "x").retryable).toBe(false);
    expect(new SocialPublishingError(codeForHttpStatus(403), "x").retryable).toBe(false);
  });

  it("treats validation and not-found as permanent", () => {
    expect(new SocialPublishingError(codeForHttpStatus(422), "x").retryable).toBe(false);
    expect(new SocialPublishingError(codeForHttpStatus(404), "x").retryable).toBe(false);
  });

  it("maps 409 to duplicate rather than something to retry", () => {
    expect(codeForHttpStatus(409)).toBe("duplicate");
    expect(new SocialPublishingError("duplicate", "x").retryable).toBe(false);
  });
});

describe("per-destination error classification", () => {
  const retryable = (raw: unknown) =>
    new SocialPublishingError(classifyTargetError(raw).code, "x").retryable;

  it("retries transient platform conditions", () => {
    expect(retryable("Media is still processing, try again later")).toBe(true);
    expect(retryable("Rate limit exceeded")).toBe(true);
    expect(retryable("Upstream request timed out")).toBe(true);
    expect(retryable({ message: "Service temporarily unavailable" })).toBe(true);
  });

  it("does NOT retry conditions a retry cannot fix", () => {
    expect(retryable("The account has been disconnected")).toBe(false);
    expect(retryable("You do not have permission to post")).toBe(false);
    expect(retryable("Unsupported video codec")).toBe(false);
    expect(retryable("Invalid account")).toBe(false);
    expect(retryable("Duplicate post already published")).toBe(false);
  });

  it("defaults an UNRECOGNISED error to permanent", () => {
    // The dangerous default would be retrying something we do not understand:
    // it can repost a video or look like spam to the platform.
    const classified = classifyTargetError("something entirely novel");
    expect(classified.code).toBe("unknown");
    expect(new SocialPublishingError(classified.code, "x").retryable).toBe(false);
  });

  it("extracts a message from several payload shapes", () => {
    expect(classifyTargetError({ message: "Rate limit" }).message).toBe("Rate limit");
    expect(classifyTargetError({ error: "Permission denied" }).message).toBe(
      "Permission denied"
    );
    expect(classifyTargetError("plain string").message).toBe("plain string");
    expect(classifyTargetError(null).message).toBeTruthy();
  });

  it("truncates a very long provider message", () => {
    expect(classifyTargetError("x".repeat(2000)).message.length).toBeLessThanOrEqual(500);
  });
});

describe("log redaction", () => {
  it("removes every credential-shaped key", () => {
    const redacted = redact({
      authorization: "Bearer sk_live_secret",
      api_key: "pfm_live_key",
      access_token: "at_secret",
      refresh_token: "rt_secret",
      nested: { token: "inner", password: "hunter2", safe: "keep" },
      safe: "keep",
    }) as Record<string, unknown>;

    const serialised = JSON.stringify(redacted);
    expect(serialised).not.toContain("sk_live_secret");
    expect(serialised).not.toContain("pfm_live_key");
    expect(serialised).not.toContain("at_secret");
    expect(serialised).not.toContain("rt_secret");
    expect(serialised).not.toContain("hunter2");
    expect(redacted.safe).toBe("keep");
    expect((redacted.nested as Record<string, unknown>).safe).toBe("keep");
  });

  it("handles arrays and survives deep nesting without throwing", () => {
    const deep: Record<string, unknown> = { token: "secret" };
    let cursor = deep;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = { token: "secret" };
      cursor.child = next;
      cursor = next;
    }
    expect(() => JSON.stringify(redact([deep, deep]))).not.toThrow();
    expect(JSON.stringify(redact({ list: [{ access_token: "x" }] }))).not.toContain('"x"');
  });
});

describe("account mapping — credentials never cross the boundary", () => {
  it("drops access and refresh tokens entirely", () => {
    const account = toConnectedAccount({
      id: "sa_1",
      platform: "tiktok",
      external_id: "user-1",
      user_id: "tt_9",
      username: "cafe",
      profile_photo_url: "https://example.com/a.png",
      status: "connected",
      metadata: { plan: "pro" },
      // Present on the wire — must not survive the mapping.
      access_token: "at_secret",
      refresh_token: "rt_secret",
    } as never);

    const serialised = JSON.stringify(account);
    expect(serialised).not.toContain("at_secret");
    expect(serialised).not.toContain("rt_secret");
    expect(account).not.toHaveProperty("access_token");
    expect(account).not.toHaveProperty("refresh_token");
    expect(account.externalAccountId).toBe("sa_1");
    expect(account.externalId).toBe("user-1");
  });

  it("strips credential-shaped keys out of provider metadata", () => {
    const account = toConnectedAccount({
      id: "sa_1",
      platform: "x",
      status: "connected",
      metadata: { page_token: "leak", secretThing: "leak", region: "th", count: 3 },
    } as never);
    expect(JSON.stringify(account.metadata)).not.toContain("leak");
    expect(account.metadata).toEqual({ region: "th", count: 3 });
  });

  it("returns null metadata when nothing safe remains", () => {
    const account = toConnectedAccount({
      id: "sa_1",
      platform: "x",
      status: "connected",
      metadata: { access_token: "leak" },
    } as never);
    expect(account.metadata).toBeNull();
  });
});

describe("result mapping", () => {
  it("carries the published URL on success", () => {
    const result = toTargetResult({
      id: "res_1",
      post_id: "post_1",
      social_account_id: "sa_1",
      success: true,
      platform_data: { id: "tt_123", url: "https://tiktok.com/@a/video/1" },
    } as never);
    expect(result.success).toBe(true);
    expect(result.publishedUrl).toBe("https://tiktok.com/@a/video/1");
    expect(result.error).toBeNull();
  });

  it("classifies a failure instead of passing the raw provider string through", () => {
    const result = toTargetResult({
      id: "res_2",
      post_id: "post_1",
      social_account_id: "sa_2",
      success: false,
      error: { message: "Account has been disconnected" },
    } as never);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("account_disconnected");
  });
});

describe("post lifecycle mapping", () => {
  it("never treats 'processed' as published", () => {
    // `processed` means the provider finished working through the post, NOT that
    // every platform accepted it. Success is decided per destination.
    expect(lifecycleToTargetStatus("processed")).toBe("publishing");
    expect(lifecycleToTargetStatus("processing")).toBe("publishing");
    expect(lifecycleToTargetStatus("scheduled")).toBe("scheduled");
    expect(lifecycleToTargetStatus("draft")).toBe("draft");
  });
});

describe("webhook verification", () => {
  const SECRET = "whsec_test_value";
  const body = JSON.stringify({ type: "social.post.result.created", data: { id: "res_1" } });

  const headersWith = (secret?: string) => {
    const h = new Headers();
    if (secret !== undefined) h.set("post-for-me-webhook-secret", secret);
    return h;
  };

  beforeEach(() => {
    process.env.POST_FOR_ME_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.POST_FOR_ME_WEBHOOK_SECRET;
  });

  it("accepts a delivery carrying the correct secret", () => {
    const event = verifyAndParseWebhook(headersWith(SECRET), body);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("social.post.result.created");
  });

  it("rejects a wrong secret", () => {
    expect(verifyAndParseWebhook(headersWith("wrong"), body)).toBeNull();
  });

  it("rejects a missing secret header", () => {
    expect(verifyAndParseWebhook(headersWith(undefined), body)).toBeNull();
  });

  it("rejects a secret of a different length without throwing", () => {
    // timingSafeEqual throws on length mismatch; the guard must handle it.
    expect(() => verifyAndParseWebhook(headersWith("short"), body)).not.toThrow();
    expect(verifyAndParseWebhook(headersWith("short"), body)).toBeNull();
    expect(verifyAndParseWebhook(headersWith(SECRET + "extra"), body)).toBeNull();
  });

  it("rejects everything when no secret is configured", () => {
    // Fail closed: an unconfigured webhook must not accept anonymous writes.
    delete process.env.POST_FOR_ME_WEBHOOK_SECRET;
    expect(verifyAndParseWebhook(headersWith(""), body)).toBeNull();
    expect(verifyAndParseWebhook(headersWith("anything"), body)).toBeNull();
  });

  it("rejects a body that is not JSON", () => {
    expect(verifyAndParseWebhook(headersWith(SECRET), "not json")).toBeNull();
  });

  it("derives a stable id so a redelivery deduplicates", () => {
    const a = verifyAndParseWebhook(headersWith(SECRET), body);
    const b = verifyAndParseWebhook(headersWith(SECRET), body);
    expect(a!.id).toBe(b!.id);
  });

  it("gives different events different ids", () => {
    const other = JSON.stringify({
      type: "social.post.result.created",
      data: { id: "res_2" },
    });
    const a = verifyAndParseWebhook(headersWith(SECRET), body);
    const b = verifyAndParseWebhook(headersWith(SECRET), other);
    expect(a!.id).not.toBe(b!.id);
  });

  it("falls back to a body hash when no id field is present", () => {
    const noId = JSON.stringify({ type: "social.account.updated" });
    const event = verifyAndParseWebhook(headersWith(SECRET), noId);
    expect(event!.id.startsWith("sha256:")).toBe(true);
  });

  it("accepts an unrecognised event type rather than rejecting it", () => {
    // Returning non-2xx would make the provider retry something we intend to
    // ignore, for 24 hours.
    const future = JSON.stringify({ type: "social.something.new", id: "evt_1" });
    const event = verifyAndParseWebhook(headersWith(SECRET), future);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("unknown");
  });
});

describe("platform vocabulary", () => {
  it("recognises supported platforms and rejects generator-only channels", () => {
    expect(isSocialPlatform("tiktok")).toBe(true);
    expect(isSocialPlatform("youtube")).toBe(true);
    // Travy and the CDN download are video-generator channels, not social
    // destinations, and must never be publishable targets.
    expect(isSocialPlatform("travy_app")).toBe(false);
    expect(isSocialPlatform("cdn")).toBe(false);
    expect(isSocialPlatform("")).toBe(false);
  });

  it("has no duplicates", () => {
    expect(new Set(SOCIAL_PLATFORMS).size).toBe(SOCIAL_PLATFORMS.length);
  });
});
