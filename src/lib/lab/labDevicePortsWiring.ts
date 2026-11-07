/**
 * PRODUCTION device deleter wiring (NOT bound: labClient refuses cleanup unless a
 * deleter is injected, and nothing injects this one yet). Every rule lives in the
 * tested lab files; this file only connects them to the real storage.
 */
import { Capacitor } from "@capacitor/core";
import {
  localMaterialsSupported,
  probeLocalMaterial,
  removeLocalMaterialFile,
  removeLocalMaterialIndexEntry,
} from "@/features/requests/localMediaStore";
import { probeFinishedVideo, removeFinishedVideo } from "@/lib/mobile/finishedVideoCache";
import { classifyFilesystemError, classifyOpfsError, presenceOf } from "@/lib/lab/labDevicePresence";
import { createProductionDeviceFiles } from "@/lib/lab/labDeviceFilesPorts";

export const labProductionDeviceFiles = createProductionDeviceFiles({
  material: {
    presence: (localId) => presenceOf(localMaterialsSupported(), () => probeLocalMaterial(localId), classifyOpfsError),
    removeFile: (localId) => removeLocalMaterialFile(localId),
    removeIndexEntry: (localId) => removeLocalMaterialIndexEntry(localId),
  },
  output: {
    presence: (assetId) => presenceOf(Capacitor.isNativePlatform(), () => probeFinishedVideo(assetId), classifyFilesystemError),
    removeFile: (assetId) => removeFinishedVideo(assetId),
  },
});
