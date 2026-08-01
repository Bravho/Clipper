import { Platform } from "@/domain/enums/Platform";

/**
 * Product copy limits used by both the distribution UI and server-side shaping.
 * These are RClipper's publishing policies; a provider's API hard limit may be
 * larger (TikTok currently allows more than our intentionally compact target).
 */
export interface ChannelCopyPolicy {
  titleMaximum?: number;
  captionMaximum?: number;
  combinedMaximum?: number;
  maximumHashtags?: number;
}

export const CHANNEL_COPY_POLICIES: Record<string, ChannelCopyPolicy> = {
  [Platform.TikTok]: {
    combinedMaximum: 150,
    maximumHashtags: 4,
  },
  [Platform.YouTube]: {
    titleMaximum: 100,
    captionMaximum: 5000,
    maximumHashtags: 15,
  },
  [Platform.Instagram]: {
    captionMaximum: 2200,
    maximumHashtags: 30,
  },
  [Platform.Facebook]: {
    captionMaximum: 5000,
    maximumHashtags: 30,
  },
};

export interface ChannelCopy {
  title?: string;
  caption: string;
  hashtags: string[];
}

interface PublishingCopyDefaults {
  defaultCaption: string | null;
  defaultHashtags: readonly string[];
  fallbackCaption?: string | null;
  fallbackHashtags?: readonly string[];
}

/**
 * Resolve the copy used to pre-fill a publishing form.
 *
 * Channel suggestions are immutable snapshots from video generation. Once a
 * video's defaults exist, those current values must win so an older suggestion
 * cannot reappear after the user edits or clears the caption/hashtags.
 */
export function resolvePublishingCopyDefaults({
  defaultCaption,
  defaultHashtags,
  fallbackCaption = null,
  fallbackHashtags = [],
}: PublishingCopyDefaults): Pick<ChannelCopy, "caption" | "hashtags"> {
  const hasCurrentDefaults =
    defaultCaption !== null || defaultHashtags.length > 0;

  return {
    caption: hasCurrentDefaults ? defaultCaption ?? "" : fallbackCaption ?? "",
    hashtags: normalizeHashtags(
      hasCurrentDefaults ? defaultHashtags : fallbackHashtags
    ),
  };
}

export interface ChannelCopyValidation {
  valid: boolean;
  titleLength: number;
  captionLength: number;
  combinedLength: number;
  policy: ChannelCopyPolicy;
}

const INLINE_HASHTAG = /#[^\s#]+/g;
const TRAILING_TAG_PUNCTUATION = /[.,!?;:…。、，！？”’"'()[\]{}]+$/g;

export function normalizeHashtag(value: string): string {
  return value
    .trim()
    .replace(/^#+/, "")
    .replace(TRAILING_TAG_PUNCTUATION, "")
    .replace(/\s+/g, "");
}

export function normalizeHashtags(
  values: Iterable<string>,
  maximum = Number.POSITIVE_INFINITY
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeHashtag(String(value));
    if (!normalized) continue;

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);

    if (result.length >= maximum) break;
  }

  return result;
}

/** Format normalized hashtag values for editable, user-facing text fields. */
export function formatHashtagText(values: Iterable<string>): string {
  return normalizeHashtags(values)
    .map((hashtag) => `#${hashtag}`)
    .join(" ");
}

/**
 * Pull inline hashtags out of a generated caption so the caption body and the
 * hashtag collection have a single owner. The UI/publisher can then compose
 * them exactly once.
 */
export function extractInlineHashtags(caption: string): {
  caption: string;
  hashtags: string[];
} {
  const hashtags: string[] = [];
  const body = (caption ?? "")
    .replace(INLINE_HASHTAG, (match) => {
      const tag = normalizeHashtag(match);
      if (tag) hashtags.push(tag);
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { caption: body, hashtags: normalizeHashtags(hashtags) };
}

export function composeChannelCopy(caption: string, hashtags: Iterable<string>): string {
  const body = (caption ?? "").trim();
  const hashtagLine = formatHashtagText(hashtags);
  return [body, hashtagLine].filter(Boolean).join("\n\n");
}

export function parseHashtagText(text: string): string[] {
  return normalizeHashtags((text ?? "").split(/[\s,]+/));
}

function safeUtf16Prefix(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  let prefix = value.slice(0, maximum);
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return prefix;
}

function shortenCaption(value: string, maximum: number): string {
  const caption = value.trim();
  if (caption.length <= maximum) return caption;
  if (maximum <= 0) return "";
  if (maximum === 1) return "…";

  const rawPrefix = safeUtf16Prefix(caption, maximum - 1).trimEnd();
  const boundary = Math.max(
    rawPrefix.lastIndexOf(" "),
    rawPrefix.lastIndexOf("\n"),
    rawPrefix.lastIndexOf("!"),
    rawPrefix.lastIndexOf("?"),
    rawPrefix.lastIndexOf("।")
  );
  const minimumUsefulBoundary = Math.floor((maximum - 1) * 0.6);
  const prefix =
    boundary >= minimumUsefulBoundary
      ? rawPrefix.slice(0, boundary).trimEnd()
      : rawPrefix;

  return `${prefix}…`;
}

/**
 * Deterministically shape generated/legacy copy for a channel. TikTok receives
 * special treatment because RClipper intentionally targets a compact combined
 * caption+hashtag string. Other channels apply their independent field and
 * hashtag limits without inheriting TikTok's compact budget.
 */
export function shapeChannelCopy(platform: string, input: ChannelCopy): ChannelCopy {
  const policy = CHANNEL_COPY_POLICIES[platform] ?? {};
  const extracted = extractInlineHashtags(input.caption ?? "");
  const title =
    policy.titleMaximum == null
      ? input.title ?? ""
      : shortenCaption(input.title ?? "", policy.titleMaximum);
  let hashtags = normalizeHashtags(
    [...extracted.hashtags, ...(input.hashtags ?? [])],
    policy.maximumHashtags
  );

  if (platform !== Platform.TikTok || !policy.combinedMaximum) {
    return {
      title,
      caption:
        policy.captionMaximum == null
          ? extracted.caption
          : shortenCaption(extracted.caption, policy.captionMaximum),
      hashtags,
    };
  }

  const maximum = policy.combinedMaximum;

  // A single very long tag must never consume the entire post. Remove lowest
  // priority tags from the end until the tag line itself fits the policy.
  while (hashtags.length > 0 && composeChannelCopy("", hashtags).length > maximum) {
    hashtags = hashtags.slice(0, -1);
  }

  const hashtagLength = composeChannelCopy("", hashtags).length;
  const separatorLength = extracted.caption && hashtags.length ? 2 : 0;
  const captionBudget = Math.max(0, maximum - hashtagLength - separatorLength);
  const caption = shortenCaption(extracted.caption, captionBudget);

  return {
    title: "",
    caption,
    hashtags,
  };
}

export function validateChannelCopy(platform: string, input: ChannelCopy): ChannelCopyValidation {
  const policy = CHANNEL_COPY_POLICIES[platform] ?? {};
  const titleLength = (input.title ?? "").length;
  const captionLength = (input.caption ?? "").length;
  const combinedLength = composeChannelCopy(input.caption ?? "", input.hashtags ?? []).length;
  const valid =
    (policy.titleMaximum == null || titleLength <= policy.titleMaximum) &&
    (policy.captionMaximum == null || captionLength <= policy.captionMaximum) &&
    (policy.combinedMaximum == null || combinedLength <= policy.combinedMaximum) &&
    (policy.maximumHashtags == null || input.hashtags.length <= policy.maximumHashtags);

  return {
    valid,
    titleLength,
    captionLength,
    combinedLength,
    policy,
  };
}
