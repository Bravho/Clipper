import { createDeviceFileOps, type DeviceFilePorts } from "@/lib/lab/labDeviceFiles";

function fakePorts(materials: string[], outputs: string[]) {
  const m = new Set(materials);
  const o = new Set(outputs);
  const removed: string[] = [];
  const ports: DeviceFilePorts = {
    materialExists: async (id) => m.has(id),
    removeMaterial: async (id) => {
      m.delete(id);
      removed.push(`m:${id}`);
    },
    outputExists: async (id) => o.has(id),
    removeOutput: async (id) => {
      o.delete(id);
      removed.push(`o:${id}`);
    },
  };
  return { ports, m, o, removed };
}

describe("device file ops over fake ports", () => {
  it("removes a present file and reports true", async () => {
    const f = fakePorts(["mat-1"], []);
    expect(await createDeviceFileOps(f.ports).deleteMaterial("mat-1")).toBe(true);
    expect(f.removed).toEqual(["m:mat-1"]);
  });

  it("an absent output is reported false and nothing is removed", async () => {
    const f = fakePorts([], []);
    expect(await createDeviceFileOps(f.ports).deleteOutput("asset-1")).toBe(false);
    expect(f.removed).toEqual([]);
  });

  it("removes only the id asked for; other files stay", async () => {
    const f = fakePorts(["a", "b"], ["x", "y"]);
    const ops = createDeviceFileOps(f.ports);
    await ops.deleteMaterial("a");
    await ops.deleteOutput("x");
    expect([...f.m]).toEqual(["b"]);
    expect([...f.o]).toEqual(["y"]);
  });
});
