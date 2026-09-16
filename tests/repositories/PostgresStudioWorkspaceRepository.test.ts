import type { Pool } from "pg";
import { PostgresStudioWorkspaceRepository } from "@/repositories/postgres/PostgresStudioWorkspaceRepository";

describe("PostgresStudioWorkspaceRepository connection recovery", () => {
  it("retries a transient first-load connection termination", async () => {
    const transientError = new Error("Connection terminated due to connection timeout");
    const query = jest.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ rows: [{ data: { brands: [], drafts: [], results: [], publishingPlans: [], selectedBrandId: "" } }] });
    const repository = new PostgresStudioWorkspaceRepository({ query } as unknown as Pool);

    await expect(repository.findByOwnerId("owner-1")).resolves.toMatchObject({
      store: { brands: [] }, persistence: "postgresql", pendingSync: false,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-connection database error", async () => {
    const query = jest.fn().mockRejectedValue(new Error("relation studio_workspaces does not exist"));
    const repository = new PostgresStudioWorkspaceRepository({ query } as unknown as Pool);

    await expect(repository.findByOwnerId("owner-1")).rejects.toThrow("does not exist");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
