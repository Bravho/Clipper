/**
 * Merchant Campaign STORY FORMATS — the short-video ideas a customer picks
 * from at the shop (19 Oct 2026).
 *
 * A shop's template keeps the LOOK (frame, text style, brand colour, cards);
 * a story format decides the STORY: how many shots and of what, the words on
 * the opening card, the default sentence and the suggested music. A shop picks
 * at most {@link MAX_STORY_FORMATS_PER_TEMPLATE} of them; the customer chooses
 * one.
 *
 * Kept deliberately light ("อย่าให้เยอะเกิน"): every format is one or two
 * shots, at most three pieces of text on screen (opening card, the customer's
 * sentence, the closing card with the code — or two small shot labels instead
 * of the opening card), and no format changes the shop's look except "Mood of
 * the Day", where changing the look IS the idea.
 *
 * Words burned into the video are here in Thai and English (the template's
 * caption language picks one). Words shown in the app (names, descriptions,
 * shot prompts, mood names) are `campaign.format.*` / `campaign.mood.*` keys
 * in `src/i18n/messages.ts`, in all three languages.
 *
 * Text never claims quality for the customer ("best", "delicious"): the
 * default sentences describe what happened, and the customer edits them.
 *
 * Placeholders: {merchant} {location} {pick} (Today's Pick) {mood} (Mood of the Day).
 */

export interface L2 {
  th: string;
  en: string;
}

export const MAX_STORY_FORMATS_PER_TEMPLATE = 4;

export interface StoryShot {
  /** Shortest usable clip, seconds. */
  minSeconds: number;
  /** Longest part used; a longer clip uses its first `maxSeconds`. */
  maxSeconds: number;
  /** Optional small label drawn at the start of this shot (Before / After). */
  label?: L2;
}

export interface StoryMood {
  id: "happy" | "chill" | "weekend";
  /** What the opening card says, e.g. "ชิลล์ ๆ". */
  title: L2;
  defaultStatement: L2;
  /** Music, look and text style the mood brings (the shop colour stays). */
  musicTrackId: string;
  motionTemplateId: string;
  textStyleId: string;
}

export interface StoryFormat {
  id: StoryFormatId;
  /** Admin label (the admin surface is English). */
  adminName: string;
  adminDescription: string;
  /** Short emoji for the picker card. */
  icon: string;
  shots: StoryShot[];
  /**
   * The opening card. `null` = none (the shot labels carry the story).
   * Empty strings fall back to the shop template's own card texts.
   */
  hook: { kicker: L2; title: L2; sub: L2 } | null;
  /** Don't name the shop until the closing card (Guess Where I Am). */
  revealAtEnd?: boolean;
  defaultStatement: L2;
  /** Suggested track when the customer does not pick one. */
  musicTrackId: string;
  /** Ask the customer for a short text that becomes the card title. */
  asksPick?: boolean;
  moods?: StoryMood[];
  /** Origin: the five Joe listed on 19 Oct, or the five added with them. */
  origin: "requested" | "added";
}

export const STORY_FORMAT_IDS = [
  "my_little_moment",
  "guess_where",
  "pov_my_day",
  "todays_pick",
  "mood_of_the_day",
  "first_bite",
  "before_after",
  "little_details",
  "with_friends",
  "tag_a_friend",
] as const;
export type StoryFormatId = (typeof STORY_FORMAT_IDS)[number];

const SAME = (text: string): L2 => ({ th: text, en: text });
const NONE: L2 = { th: "", en: "" };

export const STORY_FORMATS: Record<StoryFormatId, StoryFormat> = {
  my_little_moment: {
    id: "my_little_moment",
    adminName: "My Little Moment",
    adminDescription: "Two shots — the drink up close, then the place around it — with a 'break from a busy day' line.",
    icon: "☕",
    shots: [
      { minSeconds: 2, maxSeconds: 6 },
      { minSeconds: 2, maxSeconds: 6 },
    ],
    hook: {
      kicker: { th: "ช่วงเวลาดี ๆ ของฉัน", en: "MY LITTLE MOMENT" },
      title: NONE, // the shop name
      sub: NONE, // the location
    },
    defaultStatement: { th: "พักจากวันที่วุ่นวายสักครู่", en: "A little break from a busy day" },
    musicTrackId: "cafe-reveal",
    origin: "requested",
  },
  guess_where: {
    id: "guess_where",
    adminName: "Guess Where I Am",
    adminDescription: "One shot of the food or a corner of the shop; friends guess, the shop name is revealed at the end.",
    icon: "❓",
    shots: [{ minSeconds: 3, maxSeconds: 12 }],
    hook: {
      kicker: NONE,
      title: { th: "ทายสิ ฉันอยู่ที่ไหน?", en: "Guess where I am?" },
      sub: NONE,
    },
    revealAtEnd: true,
    defaultStatement: { th: "ใบ้ให้: อยู่แถว {location}", en: "Hint: somewhere around {location}" },
    musicTrackId: "reveal-time",
    origin: "requested",
  },
  pov_my_day: {
    id: "pov_my_day",
    adminName: "My Day's Point of View",
    adminDescription: "One first-person shot — walking in, ordering, sitting down — as seen through the customer's eyes.",
    icon: "👀",
    shots: [{ minSeconds: 4, maxSeconds: 15 }],
    hook: {
      kicker: SAME("POV"),
      title: { th: "วันของฉันที่ {merchant}", en: "My day at {merchant}" },
      sub: NONE,
    },
    defaultStatement: { th: "เดินเข้ามา สั่งเมนู แล้วนั่งพักสักครู่", en: "Walk in, order, sit for a while" },
    musicTrackId: "warm-mid-tempo-swing",
    origin: "requested",
  },
  todays_pick: {
    id: "todays_pick",
    adminName: "Today's Pick",
    adminDescription: "One shot of what the customer chose today; the name of their pick is the title.",
    icon: "⭐",
    shots: [{ minSeconds: 3, maxSeconds: 12 }],
    hook: {
      kicker: { th: "วันนี้เลือก", en: "TODAY'S PICK" },
      title: SAME("{pick}"),
      sub: SAME("{merchant}"),
    },
    asksPick: true,
    defaultStatement: { th: "ที่เลือกวันนี้ที่ {merchant}", en: "What I picked today at {merchant}" },
    musicTrackId: "fresh-and-intriguing",
    origin: "requested",
  },
  mood_of_the_day: {
    id: "mood_of_the_day",
    adminName: "Mood of the Day",
    adminDescription: "The customer picks a mood — happy, chill or weekend vibe — and the music, look and text style follow it.",
    icon: "🎨",
    shots: [{ minSeconds: 3, maxSeconds: 15 }],
    hook: {
      kicker: { th: "อารมณ์วันนี้", en: "MOOD OF THE DAY" },
      title: SAME("{mood}"),
      sub: SAME("{merchant}"),
    },
    defaultStatement: { th: "วันนี้ที่ {merchant}", en: "Today at {merchant}" },
    musicTrackId: "cafe-reveal",
    moods: [
      {
        id: "happy",
        title: { th: "แฮปปี้", en: "Happy" },
        defaultStatement: { th: "วันนี้อารมณ์ดีที่ {merchant}", en: "Feeling good today at {merchant}" },
        musicTrackId: "reveal-groove",
        motionTemplateId: "bold_pop",
        textStyleId: "street",
      },
      {
        id: "chill",
        title: { th: "ชิลล์ ๆ", en: "Chill" },
        defaultStatement: { th: "ชิลล์ ๆ ที่ {merchant}", en: "Taking it slow at {merchant}" },
        musicTrackId: "cafe-reveal",
        motionTemplateId: "framed_cream",
        textStyleId: "cafe",
      },
      {
        id: "weekend",
        title: { th: "วีคเอนด์ไวบ์", en: "Weekend vibe" },
        defaultStatement: { th: "วีคเอนด์นี้ที่ {merchant}", en: "This weekend at {merchant}" },
        musicTrackId: "buant-groove",
        motionTemplateId: "cinematic",
        textStyleId: "neon",
      },
    ],
    origin: "requested",
  },

  // ── Five more for sharing a short experience (added 19 Oct) ────────────────
  first_bite: {
    id: "first_bite",
    adminName: "First Bite",
    adminDescription: "One shot of the first bite or sip and the face that goes with it.",
    icon: "😋",
    shots: [{ minSeconds: 3, maxSeconds: 10 }],
    hook: {
      kicker: { th: "คำแรก", en: "FIRST BITE" },
      title: NONE,
      sub: NONE,
    },
    defaultStatement: { th: "คำแรกของวันนี้", en: "First bite of the day" },
    musicTrackId: "reveal-time",
    origin: "added",
  },
  before_after: {
    id: "before_after",
    adminName: "Before & After",
    adminDescription: "Two shots — the full plate or glass, then the empty one — labelled Before / After.",
    icon: "🍽️",
    shots: [
      { minSeconds: 2, maxSeconds: 6, label: { th: "ก่อน", en: "Before" } },
      { minSeconds: 2, maxSeconds: 6, label: { th: "หลัง", en: "After" } },
    ],
    hook: null,
    defaultStatement: { th: "จานเต็ม → จานเกลี้ยง", en: "Full plate → empty plate" },
    musicTrackId: "brass-fanfare-bounce",
    origin: "added",
  },
  little_details: {
    id: "little_details",
    adminName: "Little Details",
    adminDescription: "Two close-ups of small things the customer noticed — a cup, a corner, the plating.",
    icon: "🔍",
    shots: [
      { minSeconds: 2, maxSeconds: 6 },
      { minSeconds: 2, maxSeconds: 6 },
    ],
    hook: {
      kicker: { th: "มุมเล็ก ๆ", en: "LITTLE DETAILS" },
      title: NONE,
      sub: NONE,
    },
    defaultStatement: { th: "รายละเอียดเล็ก ๆ ที่ {merchant}", en: "Little details at {merchant}" },
    musicTrackId: "mellow-midrange",
    origin: "added",
  },
  with_friends: {
    id: "with_friends",
    adminName: "Out with Friends",
    adminDescription: "One shot of the table with friends — a cheers, a laugh.",
    icon: "🥂",
    shots: [{ minSeconds: 3, maxSeconds: 12 }],
    hook: {
      kicker: { th: "มากับแก๊ง", en: "OUT WITH FRIENDS" },
      title: NONE,
      sub: NONE,
    },
    defaultStatement: { th: "นัดเพื่อนมาที่ {merchant}", en: "Catching up with friends at {merchant}" },
    musicTrackId: "buant-groove",
    origin: "added",
  },
  tag_a_friend: {
    id: "tag_a_friend",
    adminName: "Tag a Friend",
    adminDescription: "One shot and a question — who would you bring here? — made for tagging friends (who then use the code).",
    icon: "🏷️",
    shots: [{ minSeconds: 3, maxSeconds: 12 }],
    hook: {
      kicker: { th: "แท็กเพื่อน", en: "TAG A FRIEND" },
      title: { th: "อยากชวนใครมาด้วย?", en: "Who would you bring here?" },
      sub: SAME("{merchant}"),
    },
    defaultStatement: { th: "แท็กเพื่อนที่อยากชวนมาด้วยกันครั้งหน้า", en: "Tag the friend you'd bring next time" },
    musicTrackId: "fresh-and-intriguing",
    origin: "added",
  },
};

export function isStoryFormatId(value: unknown): value is StoryFormatId {
  return typeof value === "string" && (STORY_FORMAT_IDS as readonly string[]).includes(value);
}

export function getStoryFormat(id: unknown): StoryFormat | null {
  return isStoryFormatId(id) ? STORY_FORMATS[id] : null;
}

/** Keep only known ids, without repeats, at most the per-shop limit. */
export function normalizeStoryFormatList(ids: unknown): StoryFormatId[] {
  if (!Array.isArray(ids)) return [];
  const out: StoryFormatId[] = [];
  for (const id of ids) {
    if (isStoryFormatId(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_STORY_FORMATS_PER_TEMPLATE);
}

export function moodOf(format: StoryFormat | null, moodId: unknown): StoryMood | null {
  if (!format?.moods?.length) return null;
  return format.moods.find((m) => m.id === moodId) ?? format.moods[0];
}

/** The total a format's shots may last (never more than the campaign cap). */
export function formatMaxSeconds(format: StoryFormat, cap: number): number {
  return Math.min(cap, format.shots.reduce((sum, shot) => sum + shot.maxSeconds, 0));
}
