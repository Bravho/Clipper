/**
 * Presence and verified deletion for the lab's device files. Pure logic over
 * injected probes, so every rule is tested without a device.
 *
 * Rules:
 *  - "absent" only when the storage PROVES the file is not there: the Capacitor
 *    plugin's structured not-found code, or an OPFS NotFoundError.
 *  - Unsupported storage, a plugin that is not available, a permission error,
 *    or any other error is "unknown". Unknown never deletes and never counts as absent.
 *  - A delete is reported as done only when the file is absent AFTER the delete.
 *    A delete that fails silently is caught by that check.
 */

export type Presence = "present" | "absent" | "unknown";

/** The Capacitor Filesystem plugin's structured code for "file does not exist" (Android and iOS). */
export const FILESYSTEM_NOT_FOUND_CODE = "OS-PLUG-FILE-0008";

/** Classifies an error from the Capacitor Filesystem plugin. */
export function classifyFilesystemError(error: unknown): Presence {
  const code = (error as { code?: unknown } | null)?.code;
  return code === FILESYSTEM_NOT_FOUND_CODE ? "absent" : "unknown";
}

/** Classifies an error from OPFS (the browser's private file storage). */
export function classifyOpfsError(error: unknown): Presence {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "NotFoundError" ? "absent" : "unknown";
}

/**
 * Presence from one probe. `supported` is false where the storage is not
 * available: that is unknown, not proof of absence.
 */
export async function presenceOf(
  supported: boolean,
  probe: () => Promise<void>,
  classify: (error: unknown) => Presence
): Promise<Presence> {
  if (!supported) return "unknown";
  try {
    await probe();
    return "present";
  } catch (error) {
    return classify(error);
  }
}

export interface VerifiedDeleteOptions {
  presence: () => Promise<Presence>;
  remove: () => Promise<void>;
}

/**
 * Deletes one file and proves the result.
 *  - absent before: nothing to do, returns false (a harmless no-op);
 *  - unknown before: throws, nothing is removed;
 *  - present before: removes, then requires "absent" afterwards. Anything else
 *    throws, so a silent failure is reported, not counted as success.
 */
export async function verifiedDelete(options: VerifiedDeleteOptions): Promise<boolean> {
  const before = await options.presence();
  if (before === "absent") return false;
  if (before === "unknown") throw new Error("presence unknown; the file is kept");
  await options.remove();
  const after = await options.presence();
  if (after === "absent") return true;
  throw new Error(`delete not verified (presence after delete: ${after})`);
}
