/**
 * Device deleter built from injected ports. The ports are thin wrappers over the
 * real storage (wired in an unapplied shared patch); here they are fakes in tests.
 * Every removal goes through strictRemove: index first kept, file confirmed gone.
 */
import { strictRemove, type RemovalPresence } from "@/lib/lab/labStrictRemoval";
import type { DeviceFileOps } from "@/lib/lab/labRuntime";

export interface DevicePorts {
  material: {
    presence(localId: string): Promise<RemovalPresence>;
    removeFile(localId: string): Promise<void>;
    removeIndexEntry(localId: string): Promise<void>;
  };
  output: {
    presence(assetId: string): Promise<RemovalPresence>;
    removeFile(assetId: string): Promise<void>;
  };
}

export function createProductionDeviceFiles(ports: DevicePorts): DeviceFileOps {
  return {
    deleteMaterial: (localId) =>
      strictRemove({
        presence: () => ports.material.presence(localId),
        removeFile: () => ports.material.removeFile(localId),
        removeIndexEntry: () => ports.material.removeIndexEntry(localId),
      }),
    // A finished-video copy has no index entry to protect here: the expiry index is separate
    // and a stale entry is harmless, so the index step is a no-op.
    deleteOutput: (assetId) =>
      strictRemove({
        presence: () => ports.output.presence(assetId),
        removeFile: () => ports.output.removeFile(assetId),
        removeIndexEntry: async () => undefined,
      }),
  };
}
