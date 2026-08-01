/**
 * Entitlement evaluation, transfer eligibility, status aggregation, idempotency
 * keys and the product catalogue.
 *
 * The central rule these guard: COLLECTING CONTENT IS FREE, PUBLISHING IS PAID.
 * Transferring a finished project and uploading your own video must never ask
 * for money; publishing must never happen without it.
 *
 * Repositories are stubbed in-memory (the same spirit as the other service
 * tests, which construct fresh Mock repositories rather than touching the global
 * registry) so nothing here needs a database.
 */

import { ManagementEntitlementService } from "@/services/management/ManagementEntitlementService";
import { ManagementPurchaseService } from "@/services/management/ManagementPurchaseService";
import { aggregatePublicationStatus } from "@/domain/models/ManagementPublication";
import { hasUsableMedia } from "@/domain/models/ManagementContent";
import {
  ManagementContentStatus,
  ManagementEntitlementType,
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
  ManagementSourceType,
} from "@/domain/enums/ManagementStatus";
import { VideoGenerationJobStatus } from "@/domain/enums/VideoGenerationJobStatus";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import {
  MANAGEMENT_PRODUCTS,
  managementPriceCredits,
  managementBundleTerms,
  findManagementProduct,
  isManagementEnabledFor,
  managementRetainedExpiryFrom,
  managementRetainedDays,
} from "@/config/management";
import { isManagementProductCode } from "@/domain/enums/ManagementProductCode";

// The feature flag is read from the environment on each call, so setting it here
// is enough — no module re-import needed.
process.env.RCLIPPER_MANAGEMENT_ENABLED = "true";

const USER = { id: "user-1", email: "a@example.com", role: "requester" };
const OTHER_USER_ID = "user-2";
const SOURCE = "req-1";
const CONTENT = "11111111-1111-4111-8111-111111111111";

/** A completed job carrying one captioned export. */
function completedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    requestId: SOURCE,
    status: VideoGenerationJobStatus.Complete,
    currentStep: VideoGenerationStep.Complete,
    captionedExport_9_16_assetId: "asset-916",
    captionedExport_16_9_assetId: null,
    captionedExport_1_1_assetId: null,
    captionedExport_4_5_assetId: null,
    finalExport_9_16_assetId: null,
    finalExport_16_9_assetId: null,
    finalExport_1_1_assetId: null,
    finalExport_4_5_assetId: null,
    finalExport_travy_assetId: null,
    ...overrides,
  } as never;
}

function contentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTENT,
    userId: USER.id,
    sourceType: ManagementSourceType.RClipperGeneration,
    sourceGenerationId: SOURCE,
    title: "Clip",
    description: null,
    thumbnailStorageKey: null,
    status: ManagementContentStatus.Ready,
    mediaExpiresAt: new Date(Date.now() + 86_400_000),
    mediaDeletedAt: null,
    transferredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

interface Stubs {
  request?: unknown;
  job?: unknown;
  effectiveExpiry?: { passId: string; startsAt: Date; expiresAt: Date } | null;
  passes?: unknown[];
  /** Spendable upload tokens the bundle repo reports. */
  tokensRemaining?: number;
  content?: unknown;
  contentById?: unknown;
}

function serviceWith(stubs: Stubs) {
  return new ManagementEntitlementService(
    {
      findById: async () =>
        stubs.request === undefined ? { id: SOURCE, userId: USER.id } : stubs.request,
    } as never,
    { findByRequestId: async () => stubs.job ?? null } as never,
    {
      findEffectiveExpiry: async () => stubs.effectiveExpiry ?? null,
      findByUserId: async () => stubs.passes ?? [],
    } as never,
    { countSpendableTokens: async () => stubs.tokensRemaining ?? 0 } as never,
    {
      findBySource: async () => stubs.content ?? null,
      findById: async () =>
        stubs.contentById === undefined ? contentItem() : stubs.contentById,
    } as never
  );
}

describe("product catalogue", () => {
  it("defines exactly the four one-time products", () => {
    expect(MANAGEMENT_PRODUCTS).toHaveLength(4);
    expect(MANAGEMENT_PRODUCTS.map((p) => p.code)).toEqual([
      "management_single_video",
      "management_access_3_months",
      "management_access_6_months",
      "management_access_1_year",
    ]);
  });

  it("gives the single-video unlock no duration and each pass the right one", () => {
    expect(findManagementProduct("management_single_video")!.durationMonths).toBeNull();
    expect(findManagementProduct("management_access_3_months")!.durationMonths).toBe(3);
    expect(findManagementProduct("management_access_6_months")!.durationMonths).toBe(6);
    expect(findManagementProduct("management_access_1_year")!.durationMonths).toBe(12);
  });

  it("charges the launch price, which is half the list price", () => {
    for (const product of MANAGEMENT_PRODUCTS) {
      expect(managementPriceCredits(product)).toBe(product.launchPriceCredits);
      expect(product.launchPriceCredits * 2).toBe(product.fullPriceCredits);
    }
  });

  it("prices the four packages as agreed", () => {
    expect(managementPriceCredits(findManagementProduct("management_single_video")!)).toBe(50);
    expect(managementPriceCredits(findManagementProduct("management_access_3_months")!)).toBe(300);
    expect(managementPriceCredits(findManagementProduct("management_access_6_months")!)).toBe(550);
    expect(managementPriceCredits(findManagementProduct("management_access_1_year")!)).toBe(1000);
  });

  it("rejects an unknown or retired product code", () => {
    // The old transfer-time product must not resolve any more.
    expect(isManagementProductCode("management_single_transfer")).toBe(false);
    expect(isManagementProductCode("management_access_2_years")).toBe(false);
    expect(findManagementProduct("nope")).toBeNull();
  });
});

describe("paid retention window", () => {
  it("defaults to the 30-day paid window", () => {
    expect(managementRetainedDays()).toBeGreaterThanOrEqual(30);
  });

  it("computes an expiry the configured number of days ahead", () => {
    const from = new Date("2026-07-29T00:00:00Z");
    const expiry = managementRetainedExpiryFrom(from);
    const days = (expiry.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(managementRetainedDays(), 5);
  });
});

describe("hasUsableMedia", () => {
  it("is true for a ready item", () => {
    expect(hasUsableMedia(contentItem())).toBe(true);
  });

  it("is false once the media has been purged", () => {
    expect(
      hasUsableMedia(
        contentItem({
          status: ManagementContentStatus.MediaExpired,
          mediaDeletedAt: new Date(),
        })
      )
    ).toBe(false);
  });

  it("is false while an upload is still in flight", () => {
    expect(hasUsableMedia(contentItem({ status: ManagementContentStatus.Uploading }))).toBe(
      false
    );
  });
});

describe("transfer eligibility — always free", () => {
  it("allows a completed, owned project with no payment involved", async () => {
    const service = serviceWith({ job: completedJob() });
    const result = await service.checkTransferEligibility(USER, SOURCE);
    expect(result.allowed).toBe(true);
    expect(result.alreadyTransferred).toBe(false);
    expect(result.videoCount).toBe(1);
    // The shape carries no price, product or entitlement field at all.
    expect(result).not.toHaveProperty("priceCredits");
    expect(result).not.toHaveProperty("entitlementType");
  });

  it("allows transfer even for a user who has never paid for anything", async () => {
    // No pass, no unlock, no credits — transfer must still be permitted.
    const service = serviceWith({ job: completedJob(), effectiveExpiry: null, passes: [] });
    expect((await service.checkTransferEligibility(USER, SOURCE)).allowed).toBe(true);
  });

  it("allows transfer after an access pass has lapsed", async () => {
    const past = new Date(Date.now() - 86_400_000);
    const service = serviceWith({
      job: completedJob(),
      effectiveExpiry: { passId: "p", startsAt: past, expiresAt: past },
      passes: [{ expiresAt: past }],
    });
    expect((await service.checkTransferEligibility(USER, SOURCE)).allowed).toBe(true);
  });

  it("refuses a project belonging to someone else", async () => {
    const service = serviceWith({
      request: { id: SOURCE, userId: OTHER_USER_ID },
      job: completedJob(),
    });
    const result = await service.checkTransferEligibility(USER, SOURCE);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_owner");
  });

  it("reports a missing project identically to a foreign one", async () => {
    // Same reason for both, so this cannot be used to probe for valid ids.
    const service = serviceWith({ request: null });
    expect((await service.checkTransferEligibility(USER, SOURCE)).reason).toBe("not_owner");
  });

  it("refuses a project whose generation has not finished", async () => {
    const service = serviceWith({
      job: completedJob({
        status: VideoGenerationJobStatus.Active,
        currentStep: VideoGenerationStep.GeneratingBaseVideo,
      }),
    });
    expect((await service.checkTransferEligibility(USER, SOURCE)).reason).toBe(
      "generation_incomplete"
    );
  });

  it("allows transfer at the distribution-review step, where exports are ready", async () => {
    // This is the download step and where the transfer panel is shown — the
    // job is not yet Publishing/Complete but its exports exist.
    const service = serviceWith({
      job: completedJob({
        status: VideoGenerationJobStatus.Active,
        currentStep: VideoGenerationStep.AwaitingDistributionReview,
      }),
    });
    expect((await service.checkTransferEligibility(USER, SOURCE)).allowed).toBe(true);
  });

  it("refuses a finished project that produced no exports", async () => {
    const service = serviceWith({
      job: completedJob({ captionedExport_9_16_assetId: null }),
    });
    expect((await service.checkTransferEligibility(USER, SOURCE)).reason).toBe(
      "no_eligible_media"
    );
  });

  it("reports an existing transfer with its content id", async () => {
    const service = serviceWith({
      job: completedJob(),
      content: { id: CONTENT },
    });
    const result = await service.checkTransferEligibility(USER, SOURCE);
    expect(result.allowed).toBe(true);
    expect(result.alreadyTransferred).toBe(true);
    expect(result.managementContentId).toBe(CONTENT);
  });
});

describe("publish entitlement — the paid gate (token-based)", () => {
  const future = new Date(Date.now() + 30 * 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  it("requires payment when the user has never bought anything", async () => {
    const service = serviceWith({ tokensRemaining: 0 });
    const result = await service.evaluateForPublish(USER, CONTENT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("payment_required");
  });

  it("allows publishing with an active access pass, spending no token", async () => {
    const service = serviceWith({
      effectiveExpiry: { passId: "pass-1", startsAt: past, expiresAt: future },
      // Even with zero tokens, the pass authorises unlimited publishing.
      tokensRemaining: 0,
    });
    const result = await service.evaluateForPublish(USER, CONTENT, new Date(), 5);
    expect(result.allowed).toBe(true);
    expect(result.accessPassId).toBe("pass-1");
    expect(result.entitlementType).toBe(ManagementEntitlementType.ThreeMonths);
  });

  it("prefers the pass over tokens when the user holds both", async () => {
    // A pass is unlimited and must be chosen first so no token is wasted.
    const service = serviceWith({
      effectiveExpiry: { passId: "pass-1", startsAt: past, expiresAt: future },
      tokensRemaining: 4,
    });
    const result = await service.evaluateForPublish(USER, CONTENT);
    expect(result.entitlementType).toBe(ManagementEntitlementType.ThreeMonths);
    expect(result.tokensRemaining).toBeUndefined();
  });

  it("allows publishing when enough upload tokens remain", async () => {
    const service = serviceWith({ tokensRemaining: 2 });
    const result = await service.evaluateForPublish(USER, CONTENT, new Date(), 2);
    expect(result.allowed).toBe(true);
    expect(result.entitlementType).toBe(ManagementEntitlementType.SingleVideo);
    expect(result.tokensRemaining).toBe(2);
  });

  it("requires payment when tokens are fewer than the targets to publish", async () => {
    // Publishing one video to three channels costs three tokens.
    const service = serviceWith({ tokensRemaining: 2 });
    const result = await service.evaluateForPublish(USER, CONTENT, new Date(), 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("payment_required");
    expect(result.tokensRemaining).toBe(2);
  });

  it("blocks publishing once the pass has lapsed and no tokens remain", async () => {
    const service = serviceWith({
      effectiveExpiry: { passId: "pass-1", startsAt: past, expiresAt: past },
      passes: [{ expiresAt: past }],
      tokensRemaining: 0,
    });
    const result = await service.evaluateForPublish(USER, CONTENT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("access_expired");
  });

  it("falls back to tokens after a pass has lapsed", async () => {
    // A user who let a pass lapse but bought a token bundle can still publish.
    const service = serviceWith({
      effectiveExpiry: { passId: "pass-1", startsAt: past, expiresAt: past },
      passes: [{ expiresAt: past }],
      tokensRemaining: 4,
    });
    const result = await service.evaluateForPublish(USER, CONTENT);
    expect(result.allowed).toBe(true);
    expect(result.entitlementType).toBe(ManagementEntitlementType.SingleVideo);
  });

  it("refuses an item belonging to someone else", async () => {
    const service = serviceWith({
      contentById: contentItem({ userId: OTHER_USER_ID }),
      effectiveExpiry: { passId: "p", startsAt: past, expiresAt: future },
    });
    const result = await service.evaluateForPublish(USER, CONTENT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_owner");
  });

  it("refuses when the stored media has been purged, even with a live pass", async () => {
    const service = serviceWith({
      contentById: contentItem({
        status: ManagementContentStatus.MediaExpired,
        mediaDeletedAt: new Date(),
      }),
      effectiveExpiry: { passId: "p", startsAt: past, expiresAt: future },
    });
    const result = await service.evaluateForPublish(USER, CONTENT);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("media_expired");
  });

  it("refuses a content item that does not exist", async () => {
    const service = serviceWith({ contentById: null });
    expect((await service.evaluateForPublish(USER, CONTENT)).reason).toBe(
      "content_not_found"
    );
  });
});

describe("feature flag", () => {
  afterEach(() => {
    process.env.RCLIPPER_MANAGEMENT_ENABLED = "true";
    delete process.env.RCLIPPER_MANAGEMENT_ALLOWED_EMAILS;
    delete process.env.RCLIPPER_MANAGEMENT_ROLLOUT_PERCENT;
  });

  it("is off when the master switch is off", () => {
    process.env.RCLIPPER_MANAGEMENT_ENABLED = "false";
    expect(isManagementEnabledFor(USER)).toBe(false);
  });

  it("is on by default — only an explicit 'false' disables it", () => {
    delete process.env.RCLIPPER_MANAGEMENT_ENABLED;
    expect(isManagementEnabledFor(USER)).toBe(true);
  });

  it("blocks even the free transfer when the feature is off", async () => {
    process.env.RCLIPPER_MANAGEMENT_ENABLED = "false";
    const service = serviceWith({ job: completedJob() });
    expect((await service.checkTransferEligibility(USER, SOURCE)).reason).toBe(
      "feature_disabled"
    );
  });

  it("admits an allowlisted email and excludes everyone else", () => {
    process.env.RCLIPPER_MANAGEMENT_ALLOWED_EMAILS = "a@example.com";
    expect(isManagementEnabledFor(USER)).toBe(true);
    expect(
      isManagementEnabledFor({ id: "x", email: "b@example.com", role: "requester" })
    ).toBe(false);
  });

  it("never applies the percentage rollout once an allowlist is configured", () => {
    // Otherwise a typo'd allowlist would silently open the feature to everyone.
    process.env.RCLIPPER_MANAGEMENT_ALLOWED_EMAILS = "nobody@example.com";
    process.env.RCLIPPER_MANAGEMENT_ROLLOUT_PERCENT = "100";
    expect(isManagementEnabledFor(USER)).toBe(false);
  });

  it("excludes everyone at 0 % rollout", () => {
    process.env.RCLIPPER_MANAGEMENT_ROLLOUT_PERCENT = "0";
    expect(isManagementEnabledFor(USER)).toBe(false);
  });

  it("always admits an admin while the switch is on", () => {
    process.env.RCLIPPER_MANAGEMENT_ROLLOUT_PERCENT = "0";
    expect(isManagementEnabledFor({ id: "admin-1", email: null, role: "admin" })).toBe(true);
  });
});

describe("idempotency keys", () => {
  // New purchases (bundle or pass) are not tied to a content item, so the key is
  // request-token based: a refresh collapses to one debit, a deliberate second
  // purchase (new token) is treated as new.
  const bundle = {
    userId: USER.id,
    productCode: "management_single_video" as const,
    managementContentId: null,
  };

  it("collapses a refreshed bundle checkout to one debit via the request token", () => {
    expect(
      ManagementPurchaseService.idempotencyKey({ ...bundle, requestToken: "token-1" })
    ).toBe(
      ManagementPurchaseService.idempotencyKey({ ...bundle, requestToken: "token-1" })
    );
  });

  it("lets a user buy a second bundle with a new request token", () => {
    // After spending four tokens the user buys again — a different token must
    // produce a different key so the second purchase actually debits.
    expect(
      ManagementPurchaseService.idempotencyKey({ ...bundle, requestToken: "token-1" })
    ).not.toBe(
      ManagementPurchaseService.idempotencyKey({ ...bundle, requestToken: "token-2" })
    );
  });

  it("differs per user and per product", () => {
    const a = { ...bundle, requestToken: "token-1" };
    expect(ManagementPurchaseService.idempotencyKey(a)).not.toBe(
      ManagementPurchaseService.idempotencyKey({ ...a, userId: OTHER_USER_ID })
    );
    expect(ManagementPurchaseService.idempotencyKey(a)).not.toBe(
      ManagementPurchaseService.idempotencyKey({
        ...a,
        productCode: "management_access_3_months",
      })
    );
  });

  it("keeps a legacy content-bound key stable and token-independent", () => {
    // Historical per-content purchase rows still resolve: when a content id is
    // present it alone determines the key, ignoring the request token.
    const legacy = {
      userId: USER.id,
      productCode: "management_single_video" as const,
      managementContentId: CONTENT,
    };
    expect(
      ManagementPurchaseService.idempotencyKey({ ...legacy, requestToken: "a" })
    ).toBe(ManagementPurchaseService.idempotencyKey({ ...legacy, requestToken: "b" }));
  });
});

describe("upload bundle terms", () => {
  it("configures the entry product as 4 tokens over 30 days", () => {
    const entry = findManagementProduct("management_single_video")!;
    expect(entry.uploadAllowance).toBe(4);
    expect(entry.accessWindowDays).toBe(30);
    expect(managementBundleTerms(entry)).toEqual({
      uploadAllowance: 4,
      accessWindowDays: 30,
    });
  });

  it("gives access passes no bundle terms (they are unlimited)", () => {
    for (const code of [
      "management_access_3_months",
      "management_access_6_months",
      "management_access_1_year",
    ] as const) {
      const pass = findManagementProduct(code)!;
      expect(pass.uploadAllowance).toBeNull();
      expect(pass.accessWindowDays).toBeNull();
      expect(managementBundleTerms(pass)).toBeNull();
    }
  });
});

describe("publication status aggregation", () => {
  const t = (status: ManagementPublicationTargetStatus) => ({ status });
  const S = ManagementPublicationTargetStatus;
  const P = ManagementPublicationStatus;

  it("is draft with no destinations", () => {
    expect(aggregatePublicationStatus([])).toBe(P.Draft);
  });

  it("is scheduled when every destination is scheduled", () => {
    expect(aggregatePublicationStatus([t(S.Scheduled), t(S.Scheduled)])).toBe(P.Scheduled);
  });

  it("is publishing when any destination is in flight", () => {
    expect(aggregatePublicationStatus([t(S.Publishing), t(S.Scheduled)])).toBe(P.Publishing);
  });

  it("is still publishing when some succeeded and work remains", () => {
    // A single success must NOT report the whole publication as published.
    expect(aggregatePublicationStatus([t(S.Published), t(S.Scheduled)])).toBe(P.Publishing);
  });

  it("is partially published on mixed success and failure", () => {
    expect(aggregatePublicationStatus([t(S.Published), t(S.Failed)])).toBe(
      P.PartiallyPublished
    );
  });

  it("is published only when every destination succeeded", () => {
    expect(aggregatePublicationStatus([t(S.Published), t(S.Published)])).toBe(P.Published);
  });

  it("is failed only when every destination failed", () => {
    expect(aggregatePublicationStatus([t(S.Failed), t(S.Failed)])).toBe(P.Failed);
  });

  it("does not let a cancelled destination turn a success into a failure", () => {
    expect(aggregatePublicationStatus([t(S.Published), t(S.Cancelled)])).toBe(P.Published);
    expect(aggregatePublicationStatus([t(S.Cancelled), t(S.Cancelled)])).toBe(P.Cancelled);
  });
});
