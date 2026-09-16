/**
 * Backstage writing guidance distilled from the storytelling lessons supplied
 * for Studio Lab. This stays out of the form: it shapes generated copy without
 * asking creators to learn or manually apply the framework.
 */
export const STORYTELLING_DELIVERY_SEQUENCE = [
  "Direction",
  "Lens",
  "Hook",
  "Context",
  "Conflict",
  "Anticipation",
  "Payoff",
  "Bookend",
  "Delivery",
  "Trust",
] as const;

export const STORYTELLING_BACKSTAGE_KNOWLEDGE = {
  attentionFlow: ["Attention", "Curiosity", "Anticipation", "Satisfaction"],
  opening: [
    "Open with a relevant visual or verbal interruption.",
    "Make the topic clear while leaving one useful unanswered question.",
    "Orient the viewer with only the context needed to understand the stakes.",
  ],
  middle: [
    "Use concrete, imageable language instead of abstractions.",
    "Build causal momentum with conflict and consequence (BUT / THEREFORE).",
    "Give clues before the answer so the viewer can predict and anticipate.",
    "Keep only details that open curiosity, add context, raise stakes, prove, or pay off.",
  ],
  ending: [
    "Deliver an answer worth the attention spent.",
    "Bookend the opening idea with new meaning when it fits.",
    "End on one memorable thought or action and reinforce trustworthy value.",
  ],
  delivery: [
    "Write for one person in a conversational voice.",
    "Vary sentence length and make every section easy to say aloud.",
    "Package useful information through story, demonstration, conflict, or emotion.",
  ],
} as const;

export const PRESENTATION_DIRECTIONS = [
  { value: "problem-solution", label: "ปัญหา → ทางออก" },
  { value: "storytelling", label: "เล่าเรื่อง" },
  { value: "educational", label: "ให้ความรู้" },
  { value: "demonstration", label: "สาธิตการใช้งาน" },
  { value: "review", label: "รีวิว / UGC" },
  { value: "custom", label: "กำหนดเอง" },
] as const;

export function getPresentationDirectionLabel(direction: string): string {
  return PRESENTATION_DIRECTIONS.find((item) => item.value === direction)?.label ?? direction;
}
