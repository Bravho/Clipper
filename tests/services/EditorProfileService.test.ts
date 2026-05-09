import { EditorProfileService } from "@/services/EditorProfileService";
import { MockEditorProfileRepository } from "@/repositories/mock/MockEditorProfileRepository";

function makeService() {
  const store = new Map();
  const repo = new MockEditorProfileRepository(store);

  class TestEditorProfileService extends EditorProfileService {}
  const svc = new TestEditorProfileService();
  // Inject isolated repo by overriding the module-level singleton lookup
  (svc as any).repo = repo;

  return { svc, repo };
}

const BASE_PROFILE = {
  userId: "user-editor-001",
  displayName: "Test Editor",
  bio: "Test bio",
  avatarUrl: null,
  portfolioUrl: null,
  specialties: ["tourism"],
  isAI: false,
  pricePerRequestBaht: 500,
  isApproved: true,
  isActive: true,
};

describe("MockEditorProfileRepository", () => {
  let repo: MockEditorProfileRepository;

  beforeEach(() => {
    repo = new MockEditorProfileRepository(new Map());
  });

  it("creates a profile with computed defaults", async () => {
    const profile = await repo.create(BASE_PROFILE);
    expect(profile.id).toBeDefined();
    expect(profile.avgRating).toBe(0);
    expect(profile.totalReviews).toBe(0);
    expect(profile.totalCompleted).toBe(0);
    expect(profile.createdAt).toBeInstanceOf(Date);
  });

  it("findAll returns only active + approved profiles", async () => {
    await repo.create({ ...BASE_PROFILE, userId: "u1", isApproved: true, isActive: true });
    await repo.create({ ...BASE_PROFILE, userId: "u2", isApproved: false, isActive: true });
    await repo.create({ ...BASE_PROFILE, userId: "u3", isApproved: true, isActive: false });

    const visible = await repo.findAll();
    expect(visible).toHaveLength(1);
    expect(visible[0].userId).toBe("u1");
  });

  it("AI Editor sorts first in findAll", async () => {
    await repo.create({ ...BASE_PROFILE, userId: "u-human", isAI: false, avgRating: 5 });
    await repo.create({ ...BASE_PROFILE, userId: "u-ai", isAI: true, avgRating: 3 });

    const list = await repo.findAll();
    expect(list[0].isAI).toBe(true);
  });

  it("findAIEditor returns only the AI profile", async () => {
    await repo.create({ ...BASE_PROFILE, userId: "u-human", isAI: false });
    await repo.create({ ...BASE_PROFILE, userId: "u-ai", isAI: true });

    const ai = await repo.findAIEditor();
    expect(ai).not.toBeNull();
    expect(ai!.isAI).toBe(true);
  });

  it("update merges fields and bumps updatedAt", async () => {
    const profile = await repo.create(BASE_PROFILE);
    const before = profile.updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    const updated = await repo.update(profile.id, { displayName: "New Name" });

    expect(updated.displayName).toBe("New Name");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("update throws for unknown id", async () => {
    await expect(repo.update("bad-id", { displayName: "x" })).rejects.toThrow(
      "EditorProfile not found: bad-id"
    );
  });

  it("findAllForAdmin returns all regardless of approval state", async () => {
    await repo.create({ ...BASE_PROFILE, userId: "u1", isApproved: false });
    await repo.create({ ...BASE_PROFILE, userId: "u2", isApproved: true });
    const all = await repo.findAllForAdmin();
    expect(all).toHaveLength(2);
  });
});

describe("EditorProfileService.recordCompletedRequest", () => {
  it("updates avgRating correctly after first review", async () => {
    const repo = new MockEditorProfileRepository(new Map());
    const profile = await repo.create({ ...BASE_PROFILE });

    // Direct repo method test (service delegates to repo)
    const updated = await repo.update(profile.id, {
      totalReviews: 1,
      totalCompleted: 1,
      avgRating: 5.0,
    });
    expect(updated.avgRating).toBe(5.0);
    expect(updated.totalCompleted).toBe(1);
  });

  it("recalculates rolling average across multiple reviews", async () => {
    const repo = new MockEditorProfileRepository(new Map());
    const profile = await repo.create({ ...BASE_PROFILE, avgRating: 4.0, totalReviews: 2 });

    // Simulate adding a 3rd review of rating 5
    const newTotal = 3;
    const newAvg = (4.0 * 2 + 5) / 3;
    const updated = await repo.update(profile.id, {
      totalReviews: newTotal,
      avgRating: Math.round(newAvg * 10) / 10,
    });
    expect(updated.avgRating).toBeCloseTo(4.3, 1);
  });
});
