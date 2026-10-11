/**
 * Instagram through Post for Me.
 *
 * Two contract details the provider needs and RClipper used to omit:
 *   - auth-url must say HOW the Instagram account signs in
 *     (`platform_data.instagram.connection_type`);
 *   - a video post must say it is a Reel (`placement: "reels"`), because the
 *     Instagram API no longer publishes a plain feed video.
 */

import { classifyTargetError } from "@/services/social-publishing/errors";
import { platformDataFor } from "@/services/social-publishing/post-for-me/accounts";
import {
  buildAccountConfigurations,
  platformPostDefaults,
} from "@/services/social-publishing/post-for-me/posts";

describe("Instagram connection request", () => {
  const original = process.env.POST_FOR_ME_INSTAGRAM_CONNECTION_TYPE;
  afterEach(() => {
    if (original === undefined) delete process.env.POST_FOR_ME_INSTAGRAM_CONNECTION_TYPE;
    else process.env.POST_FOR_ME_INSTAGRAM_CONNECTION_TYPE = original;
  });

  it("sends a connection_type for Instagram, Instagram Login by default", () => {
    delete process.env.POST_FOR_ME_INSTAGRAM_CONNECTION_TYPE;
    expect(platformDataFor("instagram")).toEqual({
      platform_data: { instagram: { connection_type: "instagram" } },
    });
  });

  it("can be switched to Facebook Login", () => {
    process.env.POST_FOR_ME_INSTAGRAM_CONNECTION_TYPE = "facebook";
    expect(platformDataFor("instagram")).toEqual({
      platform_data: { instagram: { connection_type: "facebook" } },
    });
  });

  it("falls back to Instagram Login on an unknown value", () => {
    process.env.POST_FOR_ME_INSTAGRAM_CONNECTION_TYPE = "nonsense";
    expect(platformDataFor("instagram")).toEqual({
      platform_data: { instagram: { connection_type: "instagram" } },
    });
  });

  it("adds nothing for other platforms", () => {
    expect(platformDataFor("facebook")).toEqual({});
    expect(platformDataFor("tiktok")).toEqual({});
    expect(platformDataFor("youtube")).toEqual({});
  });
});

describe("Instagram post configuration", () => {
  it("publishes Instagram videos as Reels shared to the feed", () => {
    expect(platformPostDefaults("instagram")).toEqual({
      placement: "reels",
      share_to_feed: true,
    });
    expect(platformPostDefaults("facebook")).toEqual({});
  });

  it("always configures an Instagram target, even with no copy override", () => {
    expect(
      buildAccountConfigurations([{ externalAccountId: "sa_ig", platform: "instagram" }])
    ).toEqual([
      { social_account_id: "sa_ig", configuration: { placement: "reels", share_to_feed: true } },
    ]);
  });

  it("never sends a title to Instagram but keeps the caption", () => {
    const [config] = buildAccountConfigurations([
      { externalAccountId: "sa_ig", platform: "instagram", caption: "Hi", title: "T" },
    ]);
    expect(config.configuration).toEqual({
      placement: "reels",
      share_to_feed: true,
      caption: "Hi",
    });
  });

  it("leaves other platforms exactly as before", () => {
    expect(
      buildAccountConfigurations([
        { externalAccountId: "sa_yt", platform: "youtube", caption: "c", title: "t" },
        { externalAccountId: "sa_fb", platform: "facebook" },
      ])
    ).toEqual([{ social_account_id: "sa_yt", configuration: { caption: "c", title: "t" } }]);
  });
});


describe("dead Meta login is a disconnected account", () => {
  // Verbatim from Instagram failures in production (OAuthException code 190).
  const META_190 =
    "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.";

  it("classifies OAuthException 190 as account_disconnected", () => {
    expect(classifyTargetError(META_190).code).toBe("account_disconnected");
    expect(
      classifyTargetError(
        `Failed to post to Instagram : Failed to process video media after 30 attempts: ${META_190}`
      ).code
    ).toBe("account_disconnected");
  });

  it("is not retried", () => {
    // Retrying with a dead token cannot succeed.
    expect(["network", "timeout", "rate_limited", "provider_unavailable", "media_processing"])
      .not.toContain(classifyTargetError(META_190).code);
  });
});
