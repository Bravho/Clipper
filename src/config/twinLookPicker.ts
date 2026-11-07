import type { HeyGenAspectRatio } from "@/config/heygenAspectRatios";

/** Minimal look shape needed for picking logic — satisfied by LookItem and HeyGenLook. */
export interface PickableLook {
  id: string;
  groupId?: string;
  selectable?: boolean;
  status?: string;
  imageWidth?: number;
  imageHeight?: number;
  preferredOrientation?: "portrait" | "landscape" | "square";
}

/**
 * Derive the orientation of a look from its stored dimensions or preferredOrientation.
 * Returns undefined when orientation cannot be determined.
 */
export function getLookOrientation(
  look: PickableLook
): "portrait" | "landscape" | "square" | undefined {
  if (look.preferredOrientation) return look.preferredOrientation;
  if (look.imageWidth && look.imageHeight) {
    if (look.imageHeight > look.imageWidth) return "portrait";
    if (look.imageWidth > look.imageHeight) return "landscape";
    return "square";
  }
  return undefined;
}

/** True when a look can be selected (status completed or absent, selectable not explicitly false). */
export function isSelectableLook(look: PickableLook): boolean {
  return look.selectable !== false && (!look.status || look.status === "completed");
}

/**
 * Return the preferred look orientation for a target aspect ratio.
 * Returns undefined for ratios with no strong orientation preference (1:1, 5:4, auto).
 */
export function ratioOrientation(
  ratio: HeyGenAspectRatio
): "portrait" | "landscape" | undefined {
  if (ratio === "9:16" || ratio === "4:5") return "portrait";
  if (ratio === "16:9") return "landscape";
  return undefined;
}

/**
 * Auto-pick a look within a group for the given aspect ratio.
 *
 * Priority:
 *  1. Manual override (overrides[`${groupId}:${ratio}`]) — verified still selectable.
 *  2. Orientation match within the group (portrait ↔ 9:16/4:5; landscape ↔ 16:9).
 *  3. undefined — no matching completed+selectable look, or ratio has no orientation
 *     preference (1:1, 5:4, auto). Caller should keep the current selection.
 *
 * Only auto-picks when a matching completed, selectable look exists in the same group.
 */
export function autoPickLook(
  looks: PickableLook[],
  groupId: string | undefined,
  ratio: HeyGenAspectRatio,
  overrides?: Record<string, string>
): string | undefined {
  if (!groupId) return undefined;

  const overrideKey = `${groupId}:${ratio}`;
  const overrideId = overrides?.[overrideKey];
  if (overrideId) {
    const ol = looks.find((l) => l.id === overrideId && l.groupId === groupId);
    if (ol && isSelectableLook(ol)) return overrideId;
  }

  const target = ratioOrientation(ratio);
  if (!target) return undefined;

  const groupLooks = looks.filter((l) => l.groupId === groupId && isSelectableLook(l));
  return groupLooks.find((l) => getLookOrientation(l) === target)?.id;
}
