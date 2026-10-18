"use client";

import {
  STUDIO_ACTIONS,
  STUDIO_EVENT_BATCH_MAX,
  type StudioActionName,
  type StudioEventInput,
  type StudioStepName,
} from "@/config/studioEvents";

/**
 * The studio's behaviour tracker: which screens a person sees and what they
 * press, for the admin's Conversion Funnel and Studio Activity pages.
 *
 * Fire-and-forget by design. Events wait in memory and go up in one small
 * batch every few seconds, and at once when the app goes to the background
 * (sendBeacon, which survives the WebView being suspended). Nothing here ever
 * throws into the studio, retries, or shows anything to the person.
 */

const ENDPOINT = "/api/analytics/studio-events";
const FLUSH_DELAY_MS = 4_000;

type Detail = StudioEventInput["detail"];

let queue: StudioEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionId: string | null = null;
let listening = false;
/** The step last reported, so a re-render does not count a second view. */
let lastStep: { sessionId: string; step: StudioStepName; requestId: string | null } | null = null;

function newSessionId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return random.slice(0, 32);
}

function send(events: StudioEventInput[], useBeacon: boolean): void {
  if (events.length === 0) return;
  const body = JSON.stringify({ events });
  try {
    if (useBeacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      if (navigator.sendBeacon(ENDPOINT, body)) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Analytics never reaches the person.
  }
}

/** Send everything waiting now. */
export function flushStudioEvents(useBeacon = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) {
    send(queue.splice(0, STUDIO_EVENT_BATCH_MAX), useBeacon);
  }
}

function onHidden(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    flushStudioEvents(true);
  }
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", () => flushStudioEvents(true));
}

function enqueue(event: Omit<StudioEventInput, "sessionId" | "at">): void {
  if (typeof window === "undefined") return;
  try {
    if (!sessionId) startStudioSession();
    listen();
    queue.push({ ...event, sessionId: sessionId as string, at: new Date().toISOString() });
    if (queue.length >= STUDIO_EVENT_BATCH_MAX) flushStudioEvents();
    else if (!timer) timer = setTimeout(() => flushStudioEvents(), FLUSH_DELAY_MS);
  } catch {
    // Never into the studio.
  }
}

/** A new studio visit. Called when the studio mounts. */
export function startStudioSession(requestId?: string | null): void {
  sessionId = newSessionId();
  lastStep = null;
  enqueue({ kind: "studio_open", step: null, action: null, requestId: requestId ?? null });
}

/** The person is now looking at `step`. Repeats of the same step are ignored. */
export function trackStudioStep(step: StudioStepName, requestId?: string | null): void {
  const request = requestId ?? null;
  if (
    lastStep &&
    lastStep.sessionId === sessionId &&
    lastStep.step === step &&
    lastStep.requestId === request
  ) {
    return;
  }
  enqueue({ kind: "step_view", step, action: null, requestId: request });
  lastStep = { sessionId: sessionId as string, step, requestId: request };
}

/** The person did `action`. `detail` is a few small numbers or words. */
export function trackStudioAction(
  action: StudioActionName,
  requestId?: string | null,
  detail?: Detail
): void {
  enqueue({
    kind: "action",
    step: STUDIO_ACTIONS[action].step,
    action,
    requestId: requestId ?? null,
    detail: detail ?? null,
  });
}

/** Test seam. */
export function resetStudioTrackerForTests(): StudioEventInput[] {
  const pending = queue;
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  sessionId = null;
  lastStep = null;
  return pending;
}
