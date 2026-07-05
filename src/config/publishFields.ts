/**
 * Phase 8 — per-channel publishing form field configuration.
 *
 * Each distribution channel exposes a different set of publishable fields on the
 * real platform APIs (see src/lib/social/*), so the auto-filled distribution-
 * review form is tailored per channel rather than showing one uniform shape:
 *
 *   - YouTube  → title + description (caption) + tags (hashtags)
 *   - TikTok   → caption + hashtags (the API packs these into `title`/`description`)
 *   - Instagram→ caption + hashtags (Reels caption)
 *   - Facebook → caption + hashtags (video description)
 *
 * This drives BOTH the Gemini draft-generation prompt (which fields to write per
 * channel) and the DistributionReviewPanel UI (which inputs to render). Travy
 * (TventApp) is intentionally excluded — it is rendered + posted automatically
 * in the background (EN+ZH), never edited/published from this form. CDN is
 * internal-only.
 */
import { Platform } from "@/domain/enums/Platform";

export type PublishField = "title" | "caption" | "hashtags";

export interface ChannelPublishFieldConfig {
  /** Fields shown/edited for this channel, in display order. */
  fields: PublishField[];
  /** Thai label for the caption field (varies: "คำบรรยาย" vs "รายละเอียด"). */
  captionLabel: string;
  /** Whether a title field applies (only YouTube uses a distinct title). */
  hasTitle: boolean;
}

/**
 * Channels that appear on the distribution-review publishing form (editable +
 * auto-posted on confirm). Order = display order. Travy/CDN excluded on purpose.
 */
export const PUBLISHABLE_PLATFORMS: Platform[] = [
  Platform.TikTok,
  Platform.Instagram,
  Platform.Facebook,
  Platform.YouTube,
];

export const CHANNEL_PUBLISH_FIELDS: Record<string, ChannelPublishFieldConfig> = {
  [Platform.YouTube]: {
    fields: ["title", "caption", "hashtags"],
    captionLabel: "รายละเอียด (Description)",
    hasTitle: true,
  },
  [Platform.TikTok]: {
    fields: ["caption", "hashtags"],
    captionLabel: "คำบรรยาย (Caption)",
    hasTitle: false,
  },
  [Platform.Instagram]: {
    fields: ["caption", "hashtags"],
    captionLabel: "คำบรรยาย (Caption)",
    hasTitle: false,
  },
  [Platform.Facebook]: {
    fields: ["caption", "hashtags"],
    captionLabel: "คำบรรยาย (Caption)",
    hasTitle: false,
  },
};

/** Field config for a platform, defaulting to caption+hashtags for unknowns. */
export function getPublishFieldConfig(platform: string): ChannelPublishFieldConfig {
  return (
    CHANNEL_PUBLISH_FIELDS[platform] ?? {
      fields: ["caption", "hashtags"],
      captionLabel: "คำบรรยาย (Caption)",
      hasTitle: false,
    }
  );
}

/** Whether a platform is shown on the distribution-review publishing form. */
export function isPublishablePlatform(platform: Platform): boolean {
  return PUBLISHABLE_PLATFORMS.includes(platform);
}
