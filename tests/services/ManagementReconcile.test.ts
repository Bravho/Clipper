/**
 * ManagementReconcileService — turning provider post status into per-destination
 * results and a rolled-up publication status.
 *
 * The service only ever reads provider status and writes the derived outcome, so
 * these tests pin: each result lands on the right target, the rollup follows the
 * targets, "not everything terminal yet" reports `done: false` (so the worker
 * requeues), and a provider read failure is survived without republishing.
 *
 * Every dependency is injected; nothing here needs a database or the network.
 */

jest.mock("@/lib/spaces", () => ({
  spacesSignedUrl: jest.fn(),
  spacesPublicUrl: jest.fn(),
  SIGNED_URL_TTL_SECONDS: 3600,
}));

import { ManagementReconcileService } from "@/services/management/ManagementReconcileService";
import {
  ManagementContentStatus,
  ManagementPublicationStatus,
  ManagementPublicationTargetStatus,
} from "@/domain/enums/ManagementStatus";

const PUB_ID = "pub-1";
const CONTENT_ID = "content-1";

function target(
  id: string,
  socialConnectionId: string,
  providerPostId: string | null,
  status = ManagementPublicationTargetStatus.Publishing
) {
  return {
    id,
    publicationId: PUB_ID,
    socialConnectionId,
    platform: "tiktok",
    caption: "",
    title: null,
    description: null,
    hashtags: [],
    managementContentAssetId: "asset-1",
    uploadBundleId: "bundle-1",
    providerPostId,
    providerResultId: null,
    status,
    errorCode: null,
    errorMessage: null,
    publishedUrl: null,
    scheduledAt: null,
    publishedAt: null,
    providerMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Record<string, unknown>;
}

function result(
  accountId: string,
  success: boolean,
  extra: Record<string, unknown> = {}
) {
  return {
    externalResultId: `res-${accountId}`,
    externalPostId: "post-a",
    externalAccountId: accountId,
    success,
    publishedUrl: success ? `https://x/${accountId}` : null,
    platformPostId: success ? `p-${accountId}` : null,
    error: success ? null : { code: "rejected", message: "no" },
    ...extra,
  };
}

/** Stateful fake of the publication repo. */
function fakePublications(targets: Record<string, unknown>[]) {
  const state = {
    publication: {
      id: PUB_ID,
      managementContentId: CONTENT_ID,
      providerPostId: "post-a",
      status: ManagementPublicationStatus.Publishing,
    },
    targets,
    statusUpdates: [] as string[],
  };
  return {
    state,
    findById: jest.fn(
      async (): Promise<typeof state.publication | null> => state.publication
    ),
    findTargets: jest.fn(async () => state.targets.map((t) => ({ ...t }))),
    updateTarget: jest.fn(async (id: string, fields: Record<string, unknown>) => {
      const t = state.targets.find((x) => x.id === id)!;
      Object.assign(t, fields);
      return { ...t };
    }),
    updateStatus: jest.fn(async (_id: string, status: string) => {
      state.statusUpdates.push(status);
      state.publication.status = status as ManagementPublicationStatus;
      return { ...state.publication };
    }),
  };
}

function build(
  targets: Record<string, unknown>[],
  getPostStatus: jest.Mock,
  accountByConnection: Record<string, string>
) {
  const publications = fakePublications(targets);
  const connections = {
    findById: jest.fn(async (id: string) => ({
      id,
      providerAccountId: accountByConnection[id] ?? null,
    })),
  };
  const content = { updateStatus: jest.fn(async () => ({})) };
  const provider = { getPostStatus };
  const audit = { record: jest.fn(async () => {}) };
  const service = new ManagementReconcileService(
    publications as never,
    connections as never,
    content as never,
    provider as never,
    audit as never
  );
  return { service, publications, connections, content, provider, audit };
}

describe("reconcile", () => {
  it("marks a fully-successful publication published and done", async () => {
    const getPostStatus = jest.fn(async () => ({
      externalPostId: "post-a",
      status: "processed",
      results: [result("sa_tt", true), result("sa_ig", true)],
    }));
    const h = build(
      [target("t1", "c-tt", "post-a"), target("t2", "c-ig", "post-a")],
      getPostStatus,
      { "c-tt": "sa_tt", "c-ig": "sa_ig" }
    );

    const out = await h.service.reconcile(PUB_ID);

    expect(out.done).toBe(true);
    expect(out.status).toBe(ManagementPublicationStatus.Published);
    expect(h.publications.state.targets[0].status).toBe(
      ManagementPublicationTargetStatus.Published
    );
    expect(h.publications.state.targets[0].publishedUrl).toBe("https://x/sa_tt");
    expect(h.content.updateStatus).toHaveBeenCalledWith(
      CONTENT_ID,
      ManagementContentStatus.Published
    );
  });

  it("rolls up mixed success and failure to partially published", async () => {
    const getPostStatus = jest.fn(async () => ({
      externalPostId: "post-a",
      status: "processed",
      results: [result("sa_tt", true), result("sa_ig", false)],
    }));
    const h = build(
      [target("t1", "c-tt", "post-a"), target("t2", "c-ig", "post-a")],
      getPostStatus,
      { "c-tt": "sa_tt", "c-ig": "sa_ig" }
    );

    const out = await h.service.reconcile(PUB_ID);

    expect(out.done).toBe(true);
    expect(out.status).toBe(ManagementPublicationStatus.PartiallyPublished);
    const ig = h.publications.state.targets.find((t) => t.id === "t2")!;
    expect(ig.status).toBe(ManagementPublicationTargetStatus.Failed);
    expect(ig.errorCode).toBe("rejected");
  });

  it("is not done while a destination has no provider result yet", async () => {
    // Only one of two accounts reported — the other is still publishing.
    const getPostStatus = jest.fn(async () => ({
      externalPostId: "post-a",
      status: "processing",
      results: [result("sa_tt", true)],
    }));
    const h = build(
      [target("t1", "c-tt", "post-a"), target("t2", "c-ig", "post-a")],
      getPostStatus,
      { "c-tt": "sa_tt", "c-ig": "sa_ig" }
    );

    const out = await h.service.reconcile(PUB_ID);

    expect(out.done).toBe(false);
    expect(out.status).toBe(ManagementPublicationStatus.Publishing);
  });

  it("polls each provider post when variants split into separate posts", async () => {
    const getPostStatus = jest
      .fn()
      .mockResolvedValueOnce({
        externalPostId: "post-a",
        status: "processed",
        results: [result("sa_tt", true)],
      })
      .mockResolvedValueOnce({
        externalPostId: "post-b",
        status: "processed",
        results: [result("sa_yt", true)],
      });
    const h = build(
      [target("t1", "c-tt", "post-a"), target("t2", "c-yt", "post-b")],
      getPostStatus,
      { "c-tt": "sa_tt", "c-yt": "sa_yt" }
    );

    const out = await h.service.reconcile(PUB_ID);

    expect(getPostStatus).toHaveBeenCalledTimes(2);
    expect(out.done).toBe(true);
    expect(out.status).toBe(ManagementPublicationStatus.Published);
  });

  it("survives a provider read failure without republishing and reports not done", async () => {
    const getPostStatus = jest.fn(async () => {
      throw new Error("provider unavailable");
    });
    const h = build([target("t1", "c-tt", "post-a")], getPostStatus, {
      "c-tt": "sa_tt",
    });

    const out = await h.service.reconcile(PUB_ID);

    expect(out.done).toBe(false);
    // The target was left untouched — no result was applied.
    expect(h.publications.state.targets[0].status).toBe(
      ManagementPublicationTargetStatus.Publishing
    );
  });

  it("treats a missing publication as done so the job stops retrying", async () => {
    const h = build([], jest.fn(), {});
    h.publications.findById.mockResolvedValueOnce(null);
    const out = await h.service.reconcile("gone");
    expect(out.done).toBe(true);
  });
});
