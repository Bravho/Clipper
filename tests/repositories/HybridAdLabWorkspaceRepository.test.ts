import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { HybridAdLabWorkspaceRepository } from "@/repositories/HybridAdLabWorkspaceRepository";
import { LocalAdLabWorkspaceRepository } from "@/repositories/local/LocalAdLabWorkspaceRepository";
import type { PostgresAdLabWorkspaceRepository } from "@/repositories/postgres/PostgresAdLabWorkspaceRepository";
import type { AdLabStore } from "@/domain/models/AdLab";

const store: AdLabStore = {
  brands: [], drafts: [], results: [], publishingPlans: [], socialAccounts: [], selectedBrandId: "",
};

describe("HybridAdLabWorkspaceRepository", () => {
  const databasePath = join(tmpdir(), `rclipper-hybrid-${process.pid}.sqlite`);
  const local = new LocalAdLabWorkspaceRepository(databasePath, true);

  afterAll(() => {
    local.close();
    if (existsSync(databasePath)) rmSync(databasePath);
  });

  it("keeps pending data local until the explicit sync command is run", async () => {
    const cloud = {
      upsert: jest.fn(),
      findByOwnerId: jest.fn(),
    } as unknown as PostgresAdLabWorkspaceRepository;
    const repository = new HybridAdLabWorkspaceRepository(local, cloud);

    await expect(repository.upsert("owner-1", store)).resolves.toMatchObject({
      persistence: "local", pendingSync: true,
    });
    await expect(repository.findByOwnerId("owner-1")).resolves.toMatchObject({
      persistence: "local", pendingSync: true,
    });
    expect(cloud.upsert).not.toHaveBeenCalled();
    expect(cloud.findByOwnerId).not.toHaveBeenCalled();
  });
});
