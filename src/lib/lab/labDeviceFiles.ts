/**
 * Device-file adapter for the lab cleanup. Built from injected ports, so it is
 * tested against fake storage only. NOT bound to the real device in production:
 * the lab client refuses cleanup unless a reviewed deleter is injected (see the
 * binding proposal in the checklist). An absent file resolves false, not an error.
 */
import type { DeviceFileOps } from "@/lib/lab/labRuntime";

export interface DeviceFilePorts {
  materialExists(localId: string): Promise<boolean>;
  removeMaterial(localId: string): Promise<void>;
  outputExists(assetId: string): Promise<boolean>;
  removeOutput(assetId: string): Promise<void>;
}

export function createDeviceFileOps(ports: DeviceFilePorts): DeviceFileOps {
  return {
    async deleteMaterial(localId: string): Promise<boolean> {
      if (!(await ports.materialExists(localId))) return false;
      await ports.removeMaterial(localId);
      return true;
    },
    async deleteOutput(assetId: string): Promise<boolean> {
      if (!(await ports.outputExists(assetId))) return false;
      await ports.removeOutput(assetId);
      return true;
    },
  };
}
