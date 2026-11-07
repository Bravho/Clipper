export function avatarVideoEntryAspectForTest(entry: { aspectRatio?: string }): string {
  return entry.aspectRatio ?? "9:16";
}
