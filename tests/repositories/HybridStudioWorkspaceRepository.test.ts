import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { HybridStudioWorkspaceRepository } from "@/repositories/HybridStudioWorkspaceRepository";
import { LocalStudioWorkspaceRepository } from "@/repositories/local/LocalStudioWorkspaceRepository";
import type { PostgresStudioWorkspaceRepository } from "@/repositories/postgres/PostgresStudioWorkspaceRepository";
import type { StudioStore } from "@/domain/models/Studio";

const store: StudioStore = {
  brands: [], drafts: [], results: [], publishingPlans: [], selectedBrandId: "",
};

describe("HybridStudioWorkspaceRepository", () => {
  const databasePath = join(tmpdir(), `rclipper-hybrid-${process.pid}.sqlite`);
  const local = new LocalStudioWorkspaceRepository(databasePath, true);

  afterAll(() => {
    local.close();
    if (existsSync(databasePath)) rmSync(databasePath);
  });

  it("keeps pending data local until the explicit sync command is run", async () => {
    const cloud = {
      upsert: jest.fn(),
      findByOwnerId: jest.fn(),
    } as unknown as PostgresStudioWorkspaceRepository;
    const repository = new HybridStudioWorkspaceRepository(local, cloud);

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
