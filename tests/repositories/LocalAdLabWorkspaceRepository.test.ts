import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { LocalAdLabWorkspaceRepository } from "@/repositories/local/LocalAdLabWorkspaceRepository";
import type { AdLabStore } from "@/domain/models/AdLab";

describe("LocalAdLabWorkspaceRepository", () => {
  const databasePath = join(tmpdir(), `rclipper-studio-${process.pid}.sqlite`);
  const openRepositories: LocalAdLabWorkspaceRepository[] = [];

  function repository() {
    const instance = new LocalAdLabWorkspaceRepository(databasePath);
    openRepositories.push(instance);
    return instance;
  }

  afterAll(() => {
    openRepositories.forEach((instance) => instance.close());
    if (existsSync(databasePath)) rmSync(databasePath);
  });

  it("persists a workspace across repository instances", async () => {
    const store: AdLabStore = {
      brands: [{
        id: "brand-1", name: "RClipper", product: "AI video", audience: "SMEs",
        promise: "Save time", tone: "Professional", createdAt: "2026-09-13T00:00:00.000Z",
      }],
      drafts: [], results: [], publishingPlans: [], socialAccounts: [], selectedBrandId: "brand-1",
    };

    const writer = repository();
    await writer.upsert("studio-owner", store);
    writer.close();
    const reloaded = await repository().findByOwnerId("studio-owner");

    expect(reloaded).toMatchObject({ store, persistence: "local", pendingSync: false });
  });

  it("keeps workspaces isolated by owner", async () => {
    expect(await repository().findByOwnerId("another-owner")).toMatchObject({ store: null });
  });
});
