/**
 * Tests that GET /api/ad-lab/workspace strips adsReporting from the response
 * and that PUT preserves the server's stored adsReporting.
 */

// Mock the auth and repository layers
jest.mock("@/lib/auth/helpers", () => ({
  getCurrentUser: jest.fn().mockResolvedValue({ id: "user1", email: "owner@example.com", role: "Requester" }),
}));
jest.mock("@/config/adLab", () => ({
  isAdLabEnabledFor: jest.fn().mockReturnValue(true),
}));

import { adLabWorkspaceRepository } from "@/repositories/index";
import type { AdLabWorkspaceResult } from "@/repositories/interfaces/IAdLabWorkspaceRepository";
import type { AdLabStore } from "@/domain/models/AdLab";
import type { AdsReportingState } from "@/services/ad-lab/ads-reporting/adsReportingModel";

jest.mock("@/repositories/index", () => ({
  adLabWorkspaceRepository: {
    findByOwnerId: jest.fn(),
    upsert: jest.fn(),
  },
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

const serverAdsReporting: AdsReportingState = {
  connections: [{ id: "conn1", platform: "tiktok", accountIds: ["adv1"], tokenEnc: "ENCRYPTED", tokenSource: "oauth", connectedAt: "2026-10-01T00:00:00Z" }],
  metrics: [],
  oauthStates: [{ state: "xyz", platform: "tiktok", createdAt: "2026-10-01T00:00:00Z" }],
};

const baseStore: AdLabStore = {
  brands: [],
  drafts: [],
  results: [],
  publishingPlans: [],
  socialAccounts: [],
  selectedBrandId: "",
  adsReporting: serverAdsReporting,
};

const storeResult: AdLabWorkspaceResult = {
  store: baseStore,
  persistence: "postgresql",
  pendingSync: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  (adLabWorkspaceRepository.findByOwnerId as jest.Mock).mockResolvedValue(storeResult);
  (adLabWorkspaceRepository.upsert as jest.Mock).mockImplementation((_id: string, data: AdLabStore) =>
    Promise.resolve({ store: data, persistence: "postgresql" as const, pendingSync: false }),
  );
});

describe("GET /api/ad-lab/workspace – strips adsReporting", () => {
  it("never returns tokenEnc or oauthStates to the client", async () => {
    const { GET } = await import("@/app/api/ad-lab/workspace/route");
    const res = await GET();
    const json = await res.json() as AdLabWorkspaceResult;

    expect(json.store).toBeDefined();
    expect((json.store as unknown as Record<string, unknown>)?.adsReporting).toBeUndefined();
  });
});

describe("PUT /api/ad-lab/workspace – preserves server adsReporting", () => {
  it("ignores client-sent adsReporting and keeps server tokens", async () => {
    const { PUT } = await import("@/app/api/ad-lab/workspace/route");

    const clientBody: Partial<AdLabStore> = {
      brands: [],
      drafts: [],
      results: [],
      publishingPlans: [],
      socialAccounts: [],
      selectedBrandId: "",
      // Client attempts to overwrite adsReporting (should be ignored)
      adsReporting: { connections: [], metrics: [] } as AdsReportingState,
    };

    const req = new Request("http://localhost/api/ad-lab/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientBody),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    // Check what was actually saved to the repository
    const savedData = (adLabWorkspaceRepository.upsert as jest.Mock).mock.calls[0][1] as AdLabStore;
    expect(savedData.adsReporting).toEqual(serverAdsReporting); // server's version preserved
    expect(savedData.adsReporting?.connections[0].tokenEnc).toBe("ENCRYPTED");
  });
});
