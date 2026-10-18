import { pool } from "@/lib/db";
import {
  STUDIO_ACTIONS,
  STUDIO_EVENT_BATCH_MAX,
  isStudioAction,
  isStudioEventKind,
  isStudioStep,
  type StudioEventInput,
} from "@/config/studioEvents";
import { surfaceFromUserAgent } from "@/services/analytics/LoginEventService";

/**
 * Studio behaviour recorder (migration 041, `studio_events`).
 *
 * Shared pool, no repository — append-only analytics with no domain model,
 * the same shape as LoginEventService and GateEventService. The pool is
 * constructor-injected so tests drive a stub.
 *
 * Swallows its errors: analytics must never break the studio it describes.
 */

interface QueryableDb {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/** A cleaned event, ready to insert. */
export interface CleanStudioEvent {
  kind: string;
  step: string | null;
  action: string | null;
  requestId: string | null;
  sessionId: string;
  detail: Record<string, string | number | boolean | null> | null;
  occurredAt: Date;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** How far the phone's clock may sit from the server's before it is ignored. */
const CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const MAX_DETAIL_KEYS = 8;

/** Keep only small flat values: a detail is a hint, never a payload. */
function cleanDetail(raw: unknown): CleanStudioEvent["detail"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(
    0,
    MAX_DETAIL_KEYS
  )) {
    if (!/^[a-zA-Z0-9_]{1,32}$/.test(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, 160);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate one event against the vocabulary. Returns null for anything that
 * does not fit — the batch keeps the rest.
 */
export function cleanStudioEvent(raw: unknown, now: Date = new Date()): CleanStudioEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<StudioEventInput>;
  if (!isStudioEventKind(input.kind)) return null;
  if (typeof input.sessionId !== "string" || !ID_PATTERN.test(input.sessionId)) return null;

  const step = input.step == null ? null : isStudioStep(input.step) ? input.step : undefined;
  if (step === undefined) return null;

  let action: string | null = null;
  if (input.kind === "action") {
    if (!isStudioAction(input.action)) return null;
    action = input.action;
  }
  if (input.kind !== "studio_open" && !step && !action) return null;

  const requestId =
    typeof input.requestId === "string" && ID_PATTERN.test(input.requestId)
      ? input.requestId
      : null;

  let occurredAt = now;
  if (typeof input.at === "string") {
    const parsed = Date.parse(input.at);
    if (Number.isFinite(parsed) && Math.abs(parsed - now.getTime()) <= CLOCK_TOLERANCE_MS) {
      occurredAt = new Date(parsed);
    }
  }

  return {
    kind: input.kind,
    // An action always files under the step it belongs to, whatever the phone said.
    step: action ? STUDIO_ACTIONS[action as keyof typeof STUDIO_ACTIONS].step : step,
    action,
    requestId,
    sessionId: input.sessionId,
    detail: cleanDetail(input.detail),
    occurredAt,
  };
}

export class StudioEventService {
  constructor(private db: QueryableDb = pool) {}

  /** Insert a batch in one statement. Returns how many rows were accepted. */
  async record(input: {
    userId: string;
    events: unknown[];
    userAgent?: string | null;
  }): Promise<number> {
    const now = new Date();
    const clean = input.events
      .slice(0, STUDIO_EVENT_BATCH_MAX)
      .map((event) => cleanStudioEvent(event, now))
      .filter((event): event is CleanStudioEvent => event !== null);
    if (clean.length === 0) return 0;

    const surface = surfaceFromUserAgent(input.userAgent);
    const values: unknown[] = [];
    const tuples = clean.map((event, i) => {
      const base = i * 9;
      values.push(
        input.userId,
        event.sessionId,
        event.requestId,
        event.kind,
        event.step,
        event.action,
        event.detail ? JSON.stringify(event.detail) : null,
        surface,
        event.occurredAt
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, $${base + 8}, $${base + 9})`;
    });

    try {
      await this.db.query(
        `INSERT INTO studio_events
           (user_id, session_id, request_id, kind, step, action, detail, surface, occurred_at)
         VALUES ${tuples.join(", ")}`,
        values
      );
      return clean.length;
    } catch (err) {
      console.error("[studioEvents] failed to record:", err);
      return 0;
    }
  }
}

export const studioEventService = new StudioEventService();
