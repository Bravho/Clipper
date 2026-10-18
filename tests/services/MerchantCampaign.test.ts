import { MockMerchantCampaignRepository } from "@/repositories/mock/MockMerchantCampaignRepository";
import { MerchantCampaignAdminService, campaignQrLink } from "@/services/campaigns/MerchantCampaignAdminService";
import { CampaignCreatorService, parsePostUrl } from "@/services/campaigns/CampaignCreatorService";
import { CampaignError } from "@/services/campaigns/CampaignErrors";
import {
  generateReferralCode,
  hashInstallId,
  normalizeReferralCode,
} from "@/lib/campaigns/referralCode";
import { REFERRAL_CODE_ALPHABET, isCampaignOperator } from "@/config/merchantCampaigns";
import { validateDeviceRenderManifest } from "@/lib/mobile/deviceRenderContract";
import { CAMPAIGN_CLIP_ASSET_ID, statementCues } from "@/lib/campaigns/campaignManifest";
import { BACKGROUND_MUSIC_TRACKS } from "@/config/backgroundMusic";

const INSTALL_A = "3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b";
const INSTALL_B = "7a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const ORIGIN = "https://app.rclipper.com";

async function setup(now = new Date("2026-10-18T05:00:00Z")) {
  const repo = new MockMerchantCampaignRepository();
  let clock = now;
  const admin = new MerchantCampaignAdminService(repo);
  const creator = new CampaignCreatorService(repo, () => clock);
  const merchant = await admin.createMerchant(
    { name: "Baan Kafe", category: "CAFÉ", location: "Nimman, Chiang Mai" },
    "op-1"
  );
  const template = await admin.createTemplate(
    {
      merchantId: merchant.id,
      name: "Default",
      motionTemplateId: "clean_frame",
      textStyleId: "cafe",
      accentColor: "#0E7C66",
      defaultStatement: "Coffee break at {merchant}",
      defaultMusicTrackId: "clip_sound",
    },
    "op-1"
  );
  const draft = await admin.createCampaign(
    {
      merchantId: merchant.id,
      templateId: template.id,
      title: "Opening month",
      discountPercent: 5,
      rewardDescription: "Free cookie",
      rewardCooldownDays: 30,
    },
    "op-1"
  );
  const campaign = await admin.updateCampaign(draft.id, { status: "live" });
  const access = { slug: campaign.slug, qrKey: campaign.qrKey };
  return {
    repo,
    admin,
    creator,
    merchant,
    template,
    campaign,
    access,
    advance: (days: number) => {
      clock = new Date(clock.getTime() + days * 86_400_000);
    },
  };
}

describe("referral codes", () => {
  it("uses only the unambiguous alphabet and normalises case and separators", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(4);
      for (const ch of code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
      expect(normalizeReferralCode(code.toLowerCase())).toBe(code);
    }
    expect(normalizeReferralCode(" #a7k4 ")).toBe("A7K4");
    expect(normalizeReferralCode("A7-K4")).toBe("A7K4");
    expect(normalizeReferralCode("O0I1")).toBeNull();
    expect(normalizeReferralCode("AB")).toBeNull();
  });

  it("hashes install ids (never stores them)", () => {
    expect(hashInstallId(INSTALL_A)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInstallId(INSTALL_A)).not.toContain(INSTALL_A);
    expect(hashInstallId(INSTALL_A.toUpperCase())).toBe(hashInstallId(INSTALL_A));
  });
});

describe("operator gate", () => {
  const original = process.env.CAMPAIGN_OPERATOR_EMAILS;
  afterEach(() => {
    if (original === undefined) delete process.env.CAMPAIGN_OPERATOR_EMAILS;
    else process.env.CAMPAIGN_OPERATOR_EMAILS = original;
  });

  it("defaults to the two operator accounts, case-insensitively", () => {
    delete process.env.CAMPAIGN_OPERATOR_EMAILS;
    expect(isCampaignOperator("BraveGreatHeart@gmail.com")).toBe(true);
    expect(isCampaignOperator("zephyrothz@hotmail.com")).toBe(true);
    expect(isCampaignOperator("someone@example.com")).toBe(false);
    expect(isCampaignOperator(null)).toBe(false);
  });

  it("can be replaced by CAMPAIGN_OPERATOR_EMAILS", () => {
    process.env.CAMPAIGN_OPERATOR_EMAILS = "a@x.com, b@y.com";
    expect(isCampaignOperator("b@y.com")).toBe(true);
    expect(isCampaignOperator("bravegreatheart@gmail.com")).toBe(false);
  });
});

describe("MerchantCampaignAdminService", () => {
  it("creates a draft with a random slug and QR key, stamps publishedAt on first live", async () => {
    const { campaign, admin } = await setup();
    expect(campaign.slug).toMatch(/^[a-z0-9]{8}$/);
    expect(campaign.qrKey.length).toBeGreaterThanOrEqual(16);
    expect(campaign.publishedAt).toBeInstanceOf(Date);
    expect(campaignQrLink(campaign, ORIGIN + "/")).toBe(
      `${ORIGIN}/c/${campaign.slug}?k=${encodeURIComponent(campaign.qrKey)}`
    );
    const paused = await admin.updateCampaign(campaign.id, { status: "paused" });
    const live = await admin.updateCampaign(campaign.id, { status: "live" });
    expect(live.publishedAt?.getTime()).toBe(campaign.publishedAt?.getTime());
    expect(paused.status).toBe("paused");
  });

  it("refuses a template from another shop and bad input", async () => {
    const { admin, template } = await setup();
    const other = await admin.createMerchant({ name: "Other" }, "op-1");
    await expect(
      admin.createCampaign({ merchantId: other.id, templateId: template.id, title: "x" }, "op-1")
    ).rejects.toThrow(CampaignError);
    await expect(admin.createMerchant({ name: "" }, "op-1")).rejects.toThrow(/Shop name/);
    await expect(
      admin.createTemplate({ merchantId: other.id, name: "t", defaultMusicTrackId: "nope" }, "op-1")
    ).rejects.toThrow(/music/i);
  });

  it("rotating the QR key invalidates the old link", async () => {
    const { admin, creator, campaign, access } = await setup();
    const rotated = await admin.updateCampaign(campaign.id, { rotateQrKey: true });
    expect(rotated.qrKey).not.toBe(campaign.qrKey);
    await expect(creator.resolve(access)).rejects.toMatchObject({ code: "bad_key" });
    await expect(creator.resolve({ slug: campaign.slug, qrKey: rotated.qrKey })).resolves.toBeTruthy();
  });

  it("keeps dates when a PATCH does not mention them", async () => {
    const { admin, campaign } = await setup();
    const ends = "2026-12-31T00:00:00.000Z";
    await admin.updateCampaign(campaign.id, { endsAt: ends });
    const renamed = await admin.updateCampaign(campaign.id, { title: "Renamed" });
    expect(renamed.endsAt?.toISOString()).toBe(ends);
    const cleared = await admin.updateCampaign(campaign.id, { endsAt: null });
    expect(cleared.endsAt).toBeNull();
  });
});

describe("CampaignCreatorService", () => {
  it("only opens with the QR key, and only while live", async () => {
    const { creator, admin, campaign, access } = await setup();
    await expect(creator.resolve({ slug: campaign.slug, qrKey: "wrong" })).rejects.toMatchObject({ code: "bad_key" });
    await expect(creator.resolve({ slug: campaign.slug, qrKey: null })).rejects.toMatchObject({ code: "bad_key" });
    await expect(creator.resolve({ slug: "zzzzzzzz", qrKey: "x" })).rejects.toMatchObject({ code: "not_found" });
    await admin.updateCampaign(campaign.id, { status: "paused" });
    await expect(creator.resolve(access)).rejects.toMatchObject({ code: "not_live" });
    await admin.updateCampaign(campaign.id, { status: "ended" });
    await expect(creator.resolve(access)).rejects.toMatchObject({ code: "ended" });
  });

  it("public view never leaks the QR key and fills the default sentence", async () => {
    const { creator, access, campaign } = await setup();
    const view = creator.publicView(await creator.resolve(access));
    expect(JSON.stringify(view)).not.toContain(campaign.qrKey);
    expect(view.defaultStatement).toBe("Coffee break at Baan Kafe");
    expect(view.sounds.length).toBe(BACKGROUND_MUSIC_TRACKS.length);
    expect(view.defaultSound).toBe("clip_sound");
  });

  it("refuses anything that is not a random UUID as an install id", async () => {
    const { creator, access } = await setup();
    await expect(creator.startSession(access, "356938035643809", "android")).rejects.toMatchObject({ code: "bad_install" });
    await expect(creator.startSession(access, undefined, "android")).rejects.toMatchObject({ code: "bad_install" });
  });

  it("issues one stable code per creator per campaign, distinct per creator", async () => {
    const { creator, access, repo, campaign } = await setup();
    const first = await creator.startSession(access, INSTALL_A, "ios");
    const again = await creator.startSession(access, INSTALL_A, "ios");
    const other = await creator.startSession(access, INSTALL_B, "android");
    expect(again.entry.referralCode).toBe(first.entry.referralCode);
    expect(again.creator.id).toBe(first.creator.id);
    expect(other.entry.referralCode).not.toBe(first.entry.referralCode);
    const stored = await repo.findCreatorByInstallHash(hashInstallId(INSTALL_A));
    expect(stored?.installHash).not.toContain(INSTALL_A);
    const view = await creator.lookupCode(first.entry.referralCode.toLowerCase());
    expect(view).toMatchObject({ valid: true, reason: "ok", campaign: { id: campaign.id, discountPercent: 5 } });
  });

  it("needs a session before anything else", async () => {
    const { creator, access } = await setup();
    await expect(creator.claimReward(access, INSTALL_A)).rejects.toMatchObject({ code: "no_session" });
  });

  it("grants one reward per device per campaign per cooldown", async () => {
    const { creator, access, advance } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    const first = await creator.claimReward(access, INSTALL_A);
    expect(first.granted).toBe(true);
    expect(first.nextEligibleAt).not.toBeNull();

    advance(10);
    const second = await creator.claimReward(access, INSTALL_A);
    expect(second.granted).toBe(false);
    expect(second.lastGrantedAt).toBe(first.claimedAt);
    expect(second.nextEligibleAt).toBe(first.nextEligibleAt);

    advance(21);
    const third = await creator.claimReward(access, INSTALL_A);
    expect(third.granted).toBe(true);

    const status = await creator.status(access, INSTALL_A);
    expect(status.reward.lastGrantedAt).toBe(third.claimedAt);
  });

  it("records post links (optional) and labels the platform", async () => {
    const { creator, access } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    const post = await creator.addSocialPost(access, INSTALL_A, "Look! https://www.instagram.com/reel/abc123/");
    expect(post.platform).toBe("instagram");
    await creator.addSocialPost(access, INSTALL_A, "https://www.instagram.com/reel/abc123/");
    const status = await creator.status(access, INSTALL_A);
    expect(status.posts).toHaveLength(1);
    await expect(creator.addSocialPost(access, INSTALL_A, "javascript:alert(1)")).rejects.toMatchObject({ code: "invalid" });
    expect(parsePostUrl("https://fb.watch/xyz")?.platform).toBe("facebook");
    expect(parsePostUrl("https://example.com/p")?.platform).toBe("other");
  });

  it("counts videos made", async () => {
    const { creator, access } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    await creator.recordVideoMade(access, INSTALL_A);
    expect((await creator.recordVideoMade(access, INSTALL_A)).videosMade).toBe(2);
  });
});

describe("campaign render manifest", () => {
  it("is a valid v4 final built from the original, nothing uploaded", async () => {
    const { creator, access } = await setup();
    const session = await creator.startSession(access, INSTALL_A, "ios");
    const result = await creator.renderManifest(
      access,
      INSTALL_A,
      { localId: "lm_123", mimeType: "video/quicktime", durationSeconds: 12.4, statement: "Coffee break at Baan Kafe", sound: "clip_sound" },
      ORIGIN
    );
    const m = validateDeviceRenderManifest(result.manifest);
    expect(m.stage).toBe("final");
    expect(m.ratio).toBe("9:16");
    expect(m.buildFromSources).toBe(true);
    expect(m.upload).toBeNull();
    expect(m.sources).toEqual([
      expect.objectContaining({ assetId: CAMPAIGN_CLIP_ASSET_ID, kind: "clip", localId: "lm_123" }),
    ]);
    expect(m.scenes[0].assets[0]).toMatchObject({ durationSeconds: 12.4, trimStartSeconds: 0, trimEndSeconds: 12.4 });
    expect(m.audio.musicSelected).toBe(false);
    expect(m.audio.voiceLeadInSeconds).toBe(0);
    expect(m.audio.voiceDurationSeconds).toBe(12.4);
    expect(m.voiceUrl).toMatch(/^https:\/\/app\.rclipper\.com\/musics\//);
    expect(result.useClipSound).toBe(true);
    expect(m.captionLanguages).toEqual(["th"]);
    expect(m.captions.map((c) => c.textThai).join(" ")).toContain("Coffee break");

    const items = m.textGraphics?.items ?? [];
    const hook = items.find((i) => i.kind === "hook");
    const cta = items.find((i) => i.kind === "cta");
    expect(hook).toMatchObject({ title: "Baan Kafe", sub: "Nimman, Chiang Mai", kicker: "CAFÉ" });
    expect(cta?.title).toContain(session.entry.referralCode);
    expect(cta?.brand).toContain("5%");
    expect(cta!.end).toBeLessThanOrEqual(12.4);
    expect(m.textGraphics?.fonts.every((f) => f.url.startsWith(ORIGIN))).toBe(true);
    expect(m.template).toMatchObject({ id: "clean_frame", palette: expect.objectContaining({ accent: "#0E7C66" }) });
  });

  it("caps a long clip at 15 s and uses a picked track as the sound", async () => {
    const { creator, access } = await setup();
    await creator.startSession(access, INSTALL_A, "android");
    const track = BACKGROUND_MUSIC_TRACKS[1];
    const result = await creator.renderManifest(
      access,
      INSTALL_A,
      { durationSeconds: 40, sound: track.id, statement: "" },
      ORIGIN
    );
    expect(result.pictureSeconds).toBe(15);
    expect(result.useClipSound).toBe(false);
    expect(result.musicTrackId).toBe(track.id);
    expect(result.manifest.voiceUrl).toBe(`${ORIGIN}${track.url}`);
    expect(result.manifest.captions).toHaveLength(0);
  });

  it("refuses a clip that is too short", async () => {
    const { creator, access } = await setup();
    await creator.startSession(access, INSTALL_A, "android");
    await expect(
      creator.renderManifest(access, INSTALL_A, { durationSeconds: 1 }, ORIGIN)
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("splits a long sentence into two ordered cues", () => {
    const cues = statementCues(
      "We stopped by for an afternoon coffee and the cheesecake after the market",
      0.4,
      9
    );
    expect(cues).toHaveLength(2);
    expect(cues[0].endSecond).toBeCloseTo(cues[1].startSecond);
    expect(cues[1].endSecond).toBe(9);
  });
});
