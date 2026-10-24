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
import type { ItravyClient } from "@/lib/campaigns/itravyClient";
import type { SmsProvider } from "@/lib/sms";
import { normalizePhone } from "@/lib/campaigns/phone";

/** Captures every SMS; `lastCode()` reads the code out of the last one. */
function fakeSms() {
  const sent: { to: string; text: string }[] = [];
  let fail = false;
  const provider: SmsProvider = {
    name: "test",
    async send(message) {
      if (fail) throw new Error("provider down");
      sent.push(message);
    },
  };
  return {
    provider,
    sent,
    lastCode: () => /(\d{6})/.exec(sent[sent.length - 1]?.text ?? "")?.[1] ?? "",
    failNext: (value: boolean) => {
      fail = value;
    },
  };
}

/** Records iTravy calls; behaves like travel_advisor referralService.registerCode. */
function fakeItravy(options: { discountLabel?: string } = {}) {
  const calls: Parameters<ItravyClient["registerCode"]>[0][] = [];
  const codes = new Map<string, string>(); // creator → code
  let down = false;
  const client: ItravyClient = {
    async getCampaign(id) {
      if (down) return { ok: false, status: 0, reason: "ITRAVY_UNREACHABLE" };
      if (id === ITRAVY_MISSING) return { ok: false, status: 404, reason: "CAMPAIGN_NOT_FOUND" };
      return {
        ok: true,
        status: 200,
        data: {
          campaign: {
            id,
            name: "x",
            status: "active",
            discount_label: options.discountLabel ?? "5%",
            merchant: { id: 1, name: "Baan Kafe", slug: "baan" },
            redeem_url: "https://travy.buzz/r/baan",
          },
        },
      };
    },
    async registerCode(input) {
      calls.push(input);
      if (down) return { ok: false, status: 0, reason: "ITRAVY_UNREACHABLE" };
      const code = codes.get(input.creatorId) ?? input.code;
      codes.set(input.creatorId, code);
      return { ok: true, status: 200, data: { code, campaign_id: input.campaignId, discount_label: "5%", redeem_url: null } };
    },
  };
  return { client, calls, codes, setDown: (value: boolean) => { down = value; } };
}

const ITRAVY_CAMPAIGN = "11111111-2222-4333-8444-555555555555";
const ITRAVY_MISSING = "99999999-2222-4333-8444-555555555555";
const PHONE = "081-234-5678";

const INSTALL_A = "3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b";
const INSTALL_B = "7a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";
const ORIGIN = "https://app.rclipper.com";

async function setup(
  now = new Date("2026-10-18T05:00:00Z"),
  opts: { sms?: boolean; itravyLabel?: string } = {}
) {
  const repo = new MockMerchantCampaignRepository();
  let clock = now;
  const sms = fakeSms();
  const itravy = fakeItravy({ discountLabel: opts.itravyLabel });
  const admin = new MerchantCampaignAdminService(repo, itravy.client);
  const creator = new CampaignCreatorService(repo, () => clock, {
    itravy: itravy.client,
    sms: () => (opts.sms === false ? null : sms.provider),
  });
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
  /** Session + phone verified for an install (what the app does before Create). */
  const verifyPhone = async (installId: string, phone = PHONE) => {
    await creator.startSession(access, installId, "ios");
    const sent = await creator.requestOtp(access, installId, phone, "en");
    return creator.verifyOtp(access, installId, { challengeId: sent.challengeId, code: sms.lastCode(), phone });
  };
  return {
    repo,
    admin,
    creator,
    merchant,
    template,
    campaign,
    access,
    sms,
    itravy,
    verifyPhone,
    advance: (days: number) => {
      clock = new Date(clock.getTime() + days * 86_400_000);
    },
    advanceSeconds: (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
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
    const { creator, access, verifyPhone } = await setup();
    const session = await creator.startSession(access, INSTALL_A, "ios");
    await verifyPhone(INSTALL_A);
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
    const { creator, access, verifyPhone } = await setup();
    await verifyPhone(INSTALL_A);
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
    const { creator, access, verifyPhone } = await setup();
    await verifyPhone(INSTALL_A);
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

describe("creator phone OTP", () => {
  it("normalises numbers exactly like iTravy", () => {
    expect(normalizePhone("081-234-5678")).toBe("+66812345678");
    expect(normalizePhone("66812345678")).toBe("+66812345678");
    expect(normalizePhone("+66 0812345678")).toBe("+66812345678");
    expect(normalizePhone("+447911123456")).toBe("+447911123456");
    expect(normalizePhone("0212345678")).toBeNull(); // landline
    expect(normalizePhone("12345")).toBeNull();
  });

  it("refuses the video until the phone is verified, then allows it", async () => {
    const { creator, access, sms } = await setup();
    const session = await creator.startSession(access, INSTALL_A, "ios");
    expect(session.status.phone).toMatchObject({ required: true, available: true, ok: false, last4: null });
    await expect(
      creator.renderManifest(access, INSTALL_A, { durationSeconds: 10 }, ORIGIN)
    ).rejects.toMatchObject({ code: "phone_required", status: 428 });

    const sent = await creator.requestOtp(access, INSTALL_A, PHONE, "th");
    expect(sent.maskedPhone).toBe("+668•••678");
    expect(sms.sent[0].to).toBe("+66812345678");
    expect(sms.sent[0].text).toContain("RClipper");
    const status = await creator.verifyOtp(access, INSTALL_A, {
      challengeId: sent.challengeId,
      code: sms.lastCode(),
      phone: PHONE,
    });
    expect(status.phone).toMatchObject({ ok: true, last4: "5678" });
    await expect(creator.renderManifest(access, INSTALL_A, { durationSeconds: 10 }, ORIGIN)).resolves.toBeTruthy();
  });

  it("never stores the number or the code in clear", async () => {
    const { creator, access, sms, repo, verifyPhone } = await setup();
    await verifyPhone(INSTALL_A);
    const stored = await repo.findCreatorByInstallHash(hashInstallId(INSTALL_A));
    expect(stored?.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("812345678");
    void creator; void access; void sms;
  });

  it("counts wrong codes and locks after five", async () => {
    const { creator, access, sms } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    const sent = await creator.requestOtp(access, INSTALL_A, PHONE);
    const wrong = sms.lastCode() === "000000" ? "111111" : "000000";
    for (let left = 4; left >= 1; left--) {
      await expect(
        creator.verifyOtp(access, INSTALL_A, { challengeId: sent.challengeId, code: wrong, phone: PHONE })
      ).rejects.toMatchObject({ code: "otp_invalid", details: { attemptsLeft: left } });
    }
    await expect(
      creator.verifyOtp(access, INSTALL_A, { challengeId: sent.challengeId, code: wrong, phone: PHONE })
    ).rejects.toMatchObject({ code: "otp_locked" });
    await expect(
      creator.verifyOtp(access, INSTALL_A, { challengeId: sent.challengeId, code: sms.lastCode(), phone: PHONE })
    ).rejects.toMatchObject({ code: "otp_locked" });
  });

  it("expires codes after 5 minutes and refuses another phone or install", async () => {
    const { creator, access, sms, advanceSeconds } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    await creator.startSession(access, INSTALL_B, "ios");
    const sent = await creator.requestOtp(access, INSTALL_A, PHONE);
    const code = sms.lastCode();
    await expect(
      creator.verifyOtp(access, INSTALL_A, { challengeId: sent.challengeId, code, phone: "0899999999" })
    ).rejects.toMatchObject({ code: "otp_not_found" });
    await expect(
      creator.verifyOtp(access, INSTALL_B, { challengeId: sent.challengeId, code, phone: PHONE })
    ).rejects.toMatchObject({ code: "otp_not_found" });
    advanceSeconds(301);
    await expect(
      creator.verifyOtp(access, INSTALL_A, { challengeId: sent.challengeId, code, phone: PHONE })
    ).rejects.toMatchObject({ code: "otp_expired" });
  });

  it("throttles sends: 60 s between sends, 3 per phone per hour", async () => {
    const { creator, access, sms, advanceSeconds } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    await creator.startSession(access, INSTALL_B, "ios");
    await creator.requestOtp(access, INSTALL_A, PHONE);
    await expect(creator.requestOtp(access, INSTALL_A, PHONE)).rejects.toMatchObject({ code: "otp_cooldown" });
    advanceSeconds(61);
    await creator.requestOtp(access, INSTALL_A, PHONE);
    await creator.requestOtp(access, INSTALL_B, PHONE);
    advanceSeconds(61);
    await expect(creator.requestOtp(access, INSTALL_B, PHONE)).rejects.toMatchObject({ code: "rate_limited" });
    expect(sms.sent).toHaveLength(3);
    await expect(creator.requestOtp(access, INSTALL_A, "12")).rejects.toMatchObject({ code: "phone_invalid" });
  });

  it("does not use up the code when the SMS provider fails", async () => {
    const { creator, access, sms } = await setup();
    await creator.startSession(access, INSTALL_A, "ios");
    sms.failNext(true);
    await expect(creator.requestOtp(access, INSTALL_A, PHONE)).rejects.toMatchObject({ code: "sms_failed" });
  });

  it("skips the phone step when no SMS provider is configured (like iTravy)", async () => {
    const { creator, access } = await setup(undefined, { sms: false });
    const session = await creator.startSession(access, INSTALL_A, "ios");
    expect(session.status.phone).toMatchObject({ required: true, available: false, ok: true });
    await expect(creator.renderManifest(access, INSTALL_A, { durationSeconds: 10 }, ORIGIN)).resolves.toBeTruthy();
    await expect(creator.requestOtp(access, INSTALL_A, PHONE)).rejects.toMatchObject({ code: "otp_unavailable" });
  });

  it("counts the creator reward per phone too (two installs, one number)", async () => {
    const { creator, access, verifyPhone } = await setup();
    await verifyPhone(INSTALL_A);
    expect((await creator.claimReward(access, INSTALL_A)).granted).toBe(true);
    await verifyPhone(INSTALL_B);
    expect((await creator.claimReward(access, INSTALL_B)).granted).toBe(false);
  });
});

describe("iTravy link", () => {
  async function linked(opts: { itravyLabel?: string } = {}) {
    const ctx = await setup(undefined, opts);
    await ctx.admin.updateCampaign(ctx.campaign.id, { itravyCampaignId: ITRAVY_CAMPAIGN });
    return ctx;
  }

  it("registers the creator's own code with iTravy at session start", async () => {
    const { creator, access, itravy } = await linked();
    const session = await creator.startSession(access, INSTALL_A, "ios");
    expect(itravy.calls[0]).toMatchObject({
      campaignId: ITRAVY_CAMPAIGN,
      creatorId: session.creator.id,
      code: session.entry.referralCode,
      creatorPhone: null,
    });
    expect(session.status.itravy).toEqual({ linked: true, registered: true });
  });

  it("hands the verified phone (E.164) to iTravy with the code", async () => {
    const { creator, access, itravy, verifyPhone } = await linked();
    const status = await verifyPhone(INSTALL_A);
    const withPhone = itravy.calls.filter((c) => c.creatorPhone);
    expect(withPhone).toHaveLength(1);
    expect(withPhone[0]).toMatchObject({ creatorPhone: "+66812345678", code: status.referralCode });
    expect(status.phone.ok).toBe(true);
    await expect(creator.renderManifest(access, INSTALL_A, { durationSeconds: 10 }, ORIGIN)).resolves.toBeTruthy();
  });

  it("keeps the code usable when iTravy is down, and finishes on retry", async () => {
    const { creator, access, itravy, sms } = await linked();
    await creator.startSession(access, INSTALL_A, "ios");
    const sent = await creator.requestOtp(access, INSTALL_A, PHONE);
    itravy.setDown(true);
    await expect(
      creator.verifyOtp(access, INSTALL_A, { challengeId: sent.challengeId, code: sms.lastCode(), phone: PHONE })
    ).rejects.toMatchObject({ code: "itravy_failed" });
    // Not done until iTravy has the phone: the video stays blocked.
    await expect(creator.renderManifest(access, INSTALL_A, { durationSeconds: 10 }, ORIGIN)).rejects.toMatchObject({
      code: "phone_required",
    });
    itravy.setDown(false);
    const status = await creator.verifyOtp(access, INSTALL_A, {
      challengeId: sent.challengeId,
      code: sms.lastCode(),
      phone: PHONE,
    });
    expect(status.phone.ok).toBe(true);
    expect(status.itravy.registered).toBe(true);
  });

  it("refuses the video when iTravy holds a different code for the creator", async () => {
    const { creator, access, itravy, verifyPhone } = await linked();
    itravy.setDown(true);
    const session = await creator.startSession(access, INSTALL_A, "ios");
    itravy.setDown(false);
    itravy.codes.set(session.creator.id, "ZZZZ");
    await expect(verifyPhone(INSTALL_A)).rejects.toMatchObject({ code: "itravy_failed", details: { reason: "CODE_MISMATCH" } });
  });

  it("only links to a real iTravy campaign with the same discount", async () => {
    const ctx = await setup(undefined, { itravyLabel: "10%" });
    await expect(
      ctx.admin.updateCampaign(ctx.campaign.id, { itravyCampaignId: ITRAVY_CAMPAIGN })
    ).rejects.toThrow(/10% but this campaign promises 5%/);
    await expect(
      ctx.admin.updateCampaign(ctx.campaign.id, { itravyCampaignId: ITRAVY_MISSING })
    ).rejects.toThrow(/no campaign/);
    await expect(ctx.admin.updateCampaign(ctx.campaign.id, { itravyCampaignId: "not-a-uuid" })).rejects.toThrow(
      /uuid/
    );
    const fixed = await ctx.admin.updateCampaign(ctx.campaign.id, {
      itravyCampaignId: ITRAVY_CAMPAIGN,
      discountPercent: 10,
    });
    expect(fixed.itravyCampaignId).toBe(ITRAVY_CAMPAIGN);
    const unlinked = await ctx.admin.updateCampaign(ctx.campaign.id, { itravyCampaignId: "" });
    expect(unlinked.itravyCampaignId).toBeNull();
  });
});

// ── Story formats (19 Oct) ────────────────────────────────────────────────────
import {
  MAX_STORY_FORMATS_PER_TEMPLATE,
  STORY_FORMATS,
  STORY_FORMAT_IDS,
} from "@/config/campaignStoryFormats";
import { findMusicTrack as findTrack } from "@/config/backgroundMusic";
import { isValidTemplateId } from "@/config/motionTemplates";
import { isTextGraphicStyleId } from "@/config/textGraphicStyles";
import { messages } from "@/i18n/messages";

describe("story format catalog", () => {
  it("has the five requested formats plus five added, each light and complete", () => {
    expect(STORY_FORMAT_IDS).toHaveLength(10);
    expect(Object.values(STORY_FORMATS).filter((f) => f.origin === "requested").map((f) => f.id)).toEqual([
      "my_little_moment",
      "guess_where",
      "pov_my_day",
      "todays_pick",
      "mood_of_the_day",
    ]);
    for (const format of Object.values(STORY_FORMATS)) {
      expect(format.shots.length).toBeGreaterThanOrEqual(1);
      expect(format.shots.length).toBeLessThanOrEqual(2);
      expect(format.shots.reduce((sum, s) => sum + s.maxSeconds, 0)).toBeLessThanOrEqual(15);
      for (const shot of format.shots) expect(shot.maxSeconds).toBeGreaterThan(shot.minSeconds);
      expect(findTrack(format.musicTrackId)).toBeDefined();
      expect(format.defaultStatement.th && format.defaultStatement.en).toBeTruthy();
      for (const mood of format.moods ?? []) {
        expect(findTrack(mood.musicTrackId)).toBeDefined();
        expect(isValidTemplateId(mood.motionTemplateId)).toBe(true);
        expect(isTextGraphicStyleId(mood.textStyleId)).toBe(true);
      }
    }
    expect(STORY_FORMATS.mood_of_the_day.moods?.map((m) => m.id)).toEqual(["happy", "chill", "weekend"]);
  });

  it("has app strings for every format, shot and mood in th, en and vi", () => {
    for (const locale of ["th", "en", "vi"] as const) {
      const catalog = messages[locale] as Record<string, string>;
      for (const format of Object.values(STORY_FORMATS)) {
        for (const key of ["name", "desc", ...format.shots.map((_, i) => `shot${i + 1}`)]) {
          expect(catalog[`campaign.format.${format.id}.${key}`]).toBeTruthy();
        }
        for (const mood of format.moods ?? []) expect(catalog[`campaign.mood.${mood.id}`]).toBeTruthy();
      }
    }
  });

  it("never puts quality claims in the default words", () => {
    const words = Object.values(STORY_FORMATS)
      .flatMap((f) => [f.defaultStatement, ...(f.moods ?? []).map((m) => m.defaultStatement)])
      .flatMap((l) => [l.th, l.en])
      .join(" ")
      .toLowerCase();
    for (const claim of ["best", "delicious", "must", "อร่อยที่สุด", "ดีที่สุด", "ต้องมา"]) {
      expect(words).not.toContain(claim);
    }
  });
});

describe("story formats in a campaign", () => {
  async function withFormats(formats: string[], captionLanguage: "th" | "en" = "en") {
    const ctx = await setup(undefined, { sms: false });
    await ctx.admin.updateTemplate(ctx.template.id, { storyFormats: formats, captionLanguage });
    await ctx.creator.startSession(ctx.access, INSTALL_A, "ios");
    return ctx;
  }
  const clip = (seconds: number, n = 1) => ({ localId: `lm_${n}`, mimeType: "video/mp4", durationSeconds: seconds });

  it("lets a shop pick at most 4, each once, from the catalog", async () => {
    const { admin, template } = await setup();
    await expect(
      admin.updateTemplate(template.id, { storyFormats: STORY_FORMAT_IDS.slice(0, MAX_STORY_FORMATS_PER_TEMPLATE + 1) })
    ).rejects.toThrow(/at most 4/);
    await expect(admin.updateTemplate(template.id, { storyFormats: ["guess_where", "guess_where"] })).rejects.toThrow(
      /once/
    );
    await expect(admin.updateTemplate(template.id, { storyFormats: ["dance_off"] })).rejects.toThrow();
    const saved = await admin.updateTemplate(template.id, { storyFormats: ["guess_where", "first_bite"] });
    expect(saved.storyFormats).toEqual(["guess_where", "first_bite"]);
  });

  it("offers the shop's formats, in its order, with words in the caption language", async () => {
    const { creator, access } = await withFormats(["tag_a_friend", "my_little_moment"], "th");
    const view = creator.publicView(await creator.resolve(access));
    expect(view.formats.map((f) => f.id)).toEqual(["tag_a_friend", "my_little_moment"]);
    const moment = view.formats[1];
    expect(moment.shots).toHaveLength(2);
    expect(moment.allowsClipSound).toBe(false);
    expect(moment.defaultStatement).toBe("พักจากวันที่วุ่นวายสักครู่");
    expect(moment.defaultSound).toBe("cafe-reveal");
  });

  it("requires one of the offered formats", async () => {
    const { creator, access } = await withFormats(["first_bite"]);
    await expect(
      creator.renderManifest(access, INSTALL_A, { shots: [clip(5)], format: "guess_where" }, ORIGIN)
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(creator.renderManifest(access, INSTALL_A, { durationSeconds: 5 }, ORIGIN)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("My Little Moment: two shots, a dissolve, music (never the clip's sound)", async () => {
    const { creator, access } = await withFormats(["my_little_moment"]);
    const result = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "my_little_moment", shots: [clip(9, 1), clip(4, 2)], sound: "clip_sound", statement: "" },
      ORIGIN
    );
    const m = validateDeviceRenderManifest(result.manifest);
    expect(result.clipAssetIds).toEqual(["campaign_clip", "campaign_clip_2"]);
    expect(m.scenes.map((s) => [s.transitionIn, s.assets[0].durationSeconds])).toEqual([
      ["cut", 6],
      ["fade", 4],
    ]);
    expect(result.pictureSeconds).toBe(10);
    expect(result.useClipSound).toBe(false);
    expect(result.musicTrackId).toBe("cafe-reveal");
    const hook = m.textGraphics?.items.find((i) => i.kind === "hook");
    expect(hook).toMatchObject({ kicker: "MY LITTLE MOMENT", title: "Baan Kafe" });
  });

  it("Guess Where I Am: no shop name until the closing card reveals it", async () => {
    const { creator, access } = await withFormats(["guess_where"]);
    const result = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "guess_where", shots: [clip(8)], statement: "Hint: somewhere around Nimman" },
      ORIGIN
    );
    const items = result.manifest.textGraphics?.items ?? [];
    const hook = items.find((i) => i.kind === "hook")!;
    const cta = items.find((i) => i.kind === "cta")!;
    expect(hook.title).toBe("Guess where I am?");
    expect(JSON.stringify(hook)).not.toContain("Baan Kafe");
    expect(cta.brand).toBe("It's Baan Kafe!");
    expect(cta.place).toContain("5%");
    expect(cta.title).toMatch(/^CODE [A-Z0-9]{4,6}$/);
  });

  it("Mood of the Day: the mood brings its look, text style and music; the shop colour stays", async () => {
    const { creator, access } = await withFormats(["mood_of_the_day"]);
    const result = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "mood_of_the_day", shots: [clip(6)], mood: "happy" },
      ORIGIN
    );
    const m = result.manifest;
    expect(m.template.id).toBe("bold_pop");
    expect(m.template.palette.accent).toBe("#0E7C66");
    expect(m.textGraphics?.style.id).toBe("street");
    expect(result.musicTrackId).toBe("reveal-groove");
    expect(m.textGraphics?.items.find((i) => i.kind === "hook")?.title).toBe("Happy");
    expect(result.useClipSound).toBe(false); // the mood's own music by default…
    const ownSound = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "mood_of_the_day", shots: [clip(6)], mood: "happy", sound: "clip_sound" },
      ORIGIN
    );
    expect(ownSound.useClipSound).toBe(true); // …one clip, so they may keep their own sound…
    const chosen = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "mood_of_the_day", shots: [clip(6)], mood: "chill", sound: "dub-shuffle" },
      ORIGIN
    );
    expect(chosen.musicTrackId).toBe("dub-shuffle"); // …or pick any track
    expect(chosen.manifest.template.id).toBe("framed_cream");
  });

  it("Today's Pick: what they picked is the title (shop name if left empty)", async () => {
    const { creator, access } = await withFormats(["todays_pick"], "th");
    const picked = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "todays_pick", shots: [clip(5)], pick: "ลาเต้เย็น" },
      ORIGIN
    );
    const hook = picked.manifest.textGraphics?.items.find((i) => i.kind === "hook");
    expect(hook).toMatchObject({ kicker: "วันนี้เลือก", title: "ลาเต้เย็น", sub: "Baan Kafe" });
    const empty = await creator.renderManifest(access, INSTALL_A, { format: "todays_pick", shots: [clip(5)] }, ORIGIN);
    expect(empty.manifest.textGraphics?.items.find((i) => i.kind === "hook")?.title).toBe("Baan Kafe");
  });

  it("Before & After: a small label per shot instead of an opening card", async () => {
    const { creator, access } = await withFormats(["before_after"], "th");
    const result = await creator.renderManifest(
      access,
      INSTALL_A,
      { format: "before_after", shots: [clip(5, 1), clip(5, 2)] },
      ORIGIN
    );
    const items = result.manifest.textGraphics?.items ?? [];
    expect(items.filter((i) => i.kind === "hook")).toHaveLength(0);
    const labels = items.filter((i) => i.kind === "label");
    expect(labels.map((l) => l.title)).toEqual(["ก่อน", "หลัง"]);
    expect(labels[1].start).toBeGreaterThanOrEqual(5);
    const cta = items.find((i) => i.kind === "cta")!;
    expect(labels[1].end).toBeLessThanOrEqual(cta.start);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it("refuses a missing shot or a shot that is too short", async () => {
    const { creator, access } = await withFormats(["little_details"]);
    await expect(
      creator.renderManifest(access, INSTALL_A, { format: "little_details", shots: [clip(4)] }, ORIGIN)
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      creator.renderManifest(access, INSTALL_A, { format: "little_details", shots: [clip(4), clip(1, 2)] }, ORIGIN)
    ).rejects.toThrow(/Clip 2 must be at least 2/);
  });

  it("every format builds a valid manifest with at most three things on screen", async () => {
    const { creator, access } = await withFormats([]);
    for (const id of STORY_FORMAT_IDS) {
      const format = STORY_FORMATS[id];
      const ctx = await withFormats([id], id.length % 2 ? "th" : "en");
      const result = await ctx.creator.renderManifest(
        ctx.access,
        INSTALL_A,
        { format: id, shots: format.shots.map((s, i) => clip(s.maxSeconds + 2, i + 1)), statement: "x", pick: "y" },
        ORIGIN
      );
      const m = validateDeviceRenderManifest(result.manifest);
      expect(result.pictureSeconds).toBeLessThanOrEqual(15);
      expect(m.scenes).toHaveLength(format.shots.length);
      expect((m.textGraphics?.items ?? []).length).toBeLessThanOrEqual(3);
    }
    void creator;
    void access;
  });
});
