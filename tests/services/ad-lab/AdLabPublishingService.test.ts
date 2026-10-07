/**
 * Ad Lab publishing — caption guard and deleting failed publications.
 */
jest.mock("@/repositories", () => ({ adLabPublicationRepository: {}, socialConnectionRepository: {} }));
jest.mock("@/services/social-publishing", () => ({ socialPublishingProvider: {} }));
jest.mock("@/lib/spaces", () => ({ spacesClient: {}, SPACES_BUCKET: "bucket", spacesSignedUrl: jest.fn() }));

import { AdLabPublishingService, AdLabPublishingError } from "@/services/ad-lab/AdLabPublishingService";
import { MockAdLabPublicationRepository } from "@/repositories/mock/MockAdLabPublicationRepository";
import { promotionTotal, promotionDaily } from "@/features/ad-lab/adLabPromotion";

const OWNER = "11111111-1111-4111-8111-111111111111";

function setup() {
  const publications = new MockAdLabPublicationRepository(new Map());
  const s3 = { send: jest.fn().mockResolvedValue({}) };
  const service = new AdLabPublishingService(
    publications,
    {} as never,
    {} as never,
    s3 as never,
    async () => "https://signed"
  );
  return { publications, s3, service };
}

async function makePublication(publications: MockAdLabPublicationRepository, ownerId = OWNER) {
  return publications.create({
    ownerId,
    brandId: "b1",
    draftId: "d1",
    planId: null,
    campaignName: "Campaign",
    caption: "hello",
    videoKey: `ad_lab/${ownerId}/video.mp4`,
    videoName: "video.mp4",
    targets: [{
      channel: "tiktok", connectionId: "c1", providerAccountId: "p1",
      platform: "tiktok", accountLabel: "Time Square", plannedBudget: 700,
    }],
  });
}

describe("AdLabPublishingService.publish caption guard", () => {
  it("rejects an empty caption before calling the provider", async () => {
    const { service, s3 } = setup();
    await expect(service.publish(OWNER, {
      brandId: "b1", draftId: "d1", campaignName: "c", caption: "   ",
      videoKey: `ad_lab/${OWNER}/v.mp4`, videoName: "v.mp4",
      targets: [{ channel: "tiktok", connectionId: "c1" }],
    })).rejects.toMatchObject({ code: "missing_caption" });
    expect(s3.send).toHaveBeenCalledTimes(1); // only the HeadObject check
  });
});

describe("AdLabPublishingService.deleteFailed", () => {
  it("deletes a failed publication and its uploaded video", async () => {
    const { service, publications, s3 } = setup();
    const pub = await makePublication(publications);
    await publications.setProviderPost(pub.id, null, "failed", "boom");

    await service.deleteFailed(OWNER, pub.id);

    expect(await publications.findById(pub.id)).toBeNull();
    expect(s3.send).toHaveBeenCalledTimes(1);
    expect(s3.send.mock.calls[0][0].input).toEqual({ Bucket: "bucket", Key: pub.videoKey });
  });

  it("refuses publications that are not failed", async () => {
    const { service, publications, s3 } = setup();
    const pub = await makePublication(publications);
    await publications.setProviderPost(pub.id, "post_1", "processing");

    await expect(service.deleteFailed(OWNER, pub.id)).rejects.toMatchObject({ code: "not_deletable" });
    expect(await publications.findById(pub.id)).not.toBeNull();
    expect(s3.send).not.toHaveBeenCalled();
  });

  it("refuses another owner's publication", async () => {
    const { service, publications } = setup();
    const pub = await makePublication(publications, "22222222-2222-4222-8222-222222222222");
    await publications.setProviderPost(pub.id, null, "failed");

    await expect(service.deleteFailed(OWNER, pub.id)).rejects.toBeInstanceOf(AdLabPublishingError);
    expect(await publications.findById(pub.id)).not.toBeNull();
  });
});

describe("promotion totals", () => {
  const base = { publish: true, accountIds: ["a"], advertisingEnabled: true, targetAudience: "" };
  it("daily budget × days", () => {
    const s = { ...base, budgetType: "daily" as const, budget: 100, durationDays: 7 };
    expect(promotionTotal(s)).toBe(700);
    expect(promotionDaily(s)).toBe(100);
  });
  it("one-time total spread over the period", () => {
    const s = { ...base, budgetType: "total" as const, budget: 1000, durationDays: 10 };
    expect(promotionTotal(s)).toBe(1000);
    expect(promotionDaily(s)).toBe(100);
  });
  it("is zero when promotion is off", () => {
    expect(promotionTotal({ ...base, advertisingEnabled: false, budgetType: "daily", budget: 100 })).toBe(0);
  });
});
