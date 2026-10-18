/**
 * The studio's behaviour events — one vocabulary for the phone that sends them,
 * the route that accepts them and the admin pages that read them.
 *
 * WHY THIS EXISTS. Before migration 041 the server only ever saw a studio user
 * when they crossed a pipeline boundary: a Draft created, a submission, an
 * approval. Everything that happens on the phone between those calls — opening
 * the studio, picking photos and giving up, time spent on the storyboard, how
 * many times the voice was remade — was invisible, so "where do new users stop"
 * could only be answered for the people who had already got quite far.
 *
 * ALLOW-LISTED. The route rejects names outside these lists, so a typo in the
 * client cannot quietly invent a new event that no admin page knows about, and
 * nobody can fill the table with arbitrary strings.
 */

/** The studio's seven screens, in order (MobileVideoEditor's `Step`). */
export const STUDIO_STEPS = [
  "brief",
  "source",
  "scenes",
  "audio",
  "style",
  "render",
  "channels",
] as const;

export type StudioStepName = (typeof STUDIO_STEPS)[number];

/** Admin-facing names. The studio itself shows translated names. */
export const STUDIO_STEP_LABELS: Record<StudioStepName, string> = {
  brief: "Brief",
  source: "Photos & clips",
  scenes: "Storyboard",
  audio: "Sound",
  style: "Graphic",
  render: "Render",
  channels: "Channels",
};

/**
 * Things a person does in the studio. Each belongs to the step it happens on,
 * so the activity page can list a step's clicks under that step.
 */
export const STUDIO_ACTIONS = {
  // Brief
  brief_saved: { step: "brief", label: "Saved the brief" },
  quota_blocked: { step: "brief", label: "Hit the free-video limit" },
  pricing_opened: { step: "brief", label: "Opened Pricing" },
  // Photos & clips
  media_picked: { step: "source", label: "Picked photos/clips" },
  media_removed: { step: "source", label: "Removed a photo/clip" },
  submitted: { step: "source", label: "Submitted to make the storyboard" },
  submit_failed: { step: "source", label: "Submit failed" },
  originals_missing: { step: "source", label: "Originals missing on the phone" },
  // Storyboard
  storyboard_ready: { step: "scenes", label: "Storyboard arrived" },
  storyboard_edited: { step: "scenes", label: "Edited the storyboard" },
  storyboard_approved: { step: "scenes", label: "Approved the storyboard" },
  // Sound
  voice_ready: { step: "audio", label: "Voice arrived" },
  voice_regenerated: { step: "audio", label: "Made the voice again" },
  voice_top_up: { step: "audio", label: "Bought more voice makes" },
  script_rewritten: { step: "audio", label: "Script written from the storyboard" },
  script_autofit: { step: "audio", label: "Auto-fit scenes to the voice" },
  script_approved: { step: "audio", label: "Approved the script" },
  script_approve_failed: { step: "audio", label: "Script approval failed" },
  voice_approved: { step: "audio", label: "Approved the voice" },
  voice_failed: { step: "audio", label: "Voice step failed" },
  // Graphic
  style_chosen: { step: "style", label: "Chose the look/text style" },
  // Render
  render_started: { step: "render", label: "Pressed Make the video" },
  render_start_failed: { step: "render", label: "Make the video failed" },
  render_done: { step: "render", label: "Phone render finished" },
  render_failed: { step: "render", label: "Phone render failed" },
  render_stopped: { step: "render", label: "Stopped the render" },
  render_resumed: { step: "render", label: "Resumed the render" },
  video_regenerated: { step: "render", label: "Remade the video" },
  video_approved: { step: "channels", label: "Took the main video (chose shapes)" },
  // Channels
  channel_render_started: { step: "channels", label: "Made other channel shapes" },
  channels_failed: { step: "channels", label: "Channels step failed" },
  video_downloaded: { step: "channels", label: "Downloaded a video" },
  download_blocked: { step: "channels", label: "Download blocked (package needed)" },
  sent_to_management: { step: "channels", label: "Sent to Channel Management" },
} as const satisfies Record<string, { step: StudioStepName; label: string }>;

export type StudioActionName = keyof typeof STUDIO_ACTIONS;

/** The three kinds of row. */
export const STUDIO_EVENT_KINDS = ["studio_open", "step_view", "action"] as const;
export type StudioEventKind = (typeof STUDIO_EVENT_KINDS)[number];

/** One event as the phone sends it. */
export interface StudioEventInput {
  kind: StudioEventKind;
  /** The screen it happened on. Required for step_view and action. */
  step?: StudioStepName | null;
  /** Required for action. */
  action?: StudioActionName | null;
  requestId?: string | null;
  /** One studio visit: from opening the studio to leaving it. */
  sessionId: string;
  /** Small, flat, numbers/short strings only (e.g. {photos: 4, clips: 1}). */
  detail?: Record<string, string | number | boolean | null> | null;
  /** Client clock, ISO. The server keeps it only if it is plausible. */
  at?: string | null;
}

/** Most events one request may carry; the client flushes long before this. */
export const STUDIO_EVENT_BATCH_MAX = 50;

export function isStudioStep(value: unknown): value is StudioStepName {
  return typeof value === "string" && (STUDIO_STEPS as readonly string[]).includes(value);
}

export function isStudioAction(value: unknown): value is StudioActionName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STUDIO_ACTIONS, value);
}

export function isStudioEventKind(value: unknown): value is StudioEventKind {
  return typeof value === "string" && (STUDIO_EVENT_KINDS as readonly string[]).includes(value);
}
