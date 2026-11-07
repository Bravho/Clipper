/**
 * Lab-safe removal of one retained file and its index entry. Pure logic over
 * injected ports, so the rules are tested without a device.
 *
 * Rules:
 *  - The index entry is removed ONLY after the file is confirmed gone. Until then
 *    the index keeps pointing at the file, so nothing is untracked by mistake.
 *  - A file that is already absent: its stale index entry is removed, and the
 *    result is "nothing removed" (false). Genuine absence is not an error.
 *  - Unknown presence (unsupported storage, unavailable plugin, permission error)
 *    throws before anything is removed.
 *  - A failed file removal propagates. The index is left untouched.
 *  - A file still present after the removal is a failure. The index is left untouched.
 *  - If the index update itself fails after the file is gone, the error propagates.
 *    The next run sees the file absent and removes the stale entry.
 */

export type RemovalPresence = "present" | "absent" | "unknown";

export interface StrictRemovalPorts {
  /** present, absent (proven), or unknown. Never throws for an ordinary missing file. */
  presence(): Promise<RemovalPresence>;
  /** Removes the file. Must propagate any failure. */
  removeFile(): Promise<void>;
  /** Removes this file's index entry. */
  removeIndexEntry(): Promise<void>;
}

/** Returns true when a file was removed, false when it was already absent. Throws otherwise. */
export async function strictRemove(ports: StrictRemovalPorts): Promise<boolean> {
  const before = await ports.presence();
  if (before === "unknown") throw new Error("presence unknown; the file and its index entry are kept");
  if (before === "absent") {
    await ports.removeIndexEntry();
    return false;
  }
  await ports.removeFile();
  const after = await ports.presence();
  if (after !== "absent") throw new Error(`removal not confirmed (presence after removal: ${after}); index kept`);
  await ports.removeIndexEntry();
  return true;
}
